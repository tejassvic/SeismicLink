"""Three deterministic virtual seismograph nodes for a repeatable presentation demo."""
import asyncio, math, os, time, uuid
import socketio

URL = os.getenv('SOCKET_URL', 'http://backend:9001')
SPEED = float(os.getenv('SIM_SPEED', '20'))  # 20x playback keeps a 70-second record quick to demo.
SAMPLE_COUNT = int(os.getenv('SIM_SAMPLE_COUNT', '7000'))
SAMPLE_RATE = 100
BOOT = uuid.uuid4().hex[:16].upper()
GROUP = 'DEMO-' + uuid.uuid4().hex[:10]
EPICENTER = (30.3165, 78.0322)  # illustrative coordinates; change for your presentation area.
NODES = [
    {'module_id':4101,'lat':30.3450,'lon':78.0350},
    {'module_id':4102,'lat':30.2850,'lon':78.0900},
    {'module_id':4103,'lat':30.3100,'lon':77.9750},
]

def distance_km(a,b):
    r=6371.0; p1,p2=map(math.radians,[a[0],b[0]]); dp=math.radians(b[0]-a[0]); dl=math.radians(b[1]-a[1])
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*r*math.asin(math.sqrt(h))

def waveform(t, p, s, seed):
    # Quiet baseline + P arrival + stronger S arrival, with a reproducible small variation.
    baseline=0.0008*math.sin(2*math.pi*1.7*t+seed)
    p_env=max(0.0,min(1.0,(t-p)/0.25)) if t>=p else 0.0
    s_env=max(0.0,min(1.0,(t-s)/0.45)) if t>=s else 0.0
    px=0.012*p_env*math.sin(2*math.pi*7.0*(t-p))
    sx=0.045*s_env*math.sin(2*math.pi*3.2*(t-s))
    return baseline+px+sx, 0.7*baseline+0.7*px+1.2*sx, 0.9+0.15*baseline+0.5*px+0.8*sx

async def heartbeat(client, node, event_active=False):
    await client.emit('sensor_heartbeat', {'module_id':node['module_id'],'gateway_boot_id':BOOT,'timestamp_ms':int(time.monotonic()*1000),'device_uptime_ms':int(time.monotonic()*1000),'unix_time_ms':int(time.time()*1000),'time_synced':True,'time_quality':'simulated_clock','sample_index':0,'event_active':event_active,'sensor_healthy':True,'tx_errors':0})

async def run_node(node, origin_ms):
    client=socketio.AsyncClient(reconnection=True, logger=False, engineio_logger=False)
    await client.connect(URL, transports=['websocket','polling'])
    mid=node['module_id']
    hello = await client.call('gateway_hello',{'module_id':mid,'gateway_boot_id':BOOT,'protocol_version':1,'firmware':'SeismoLink-Python-Simulator'},timeout=10)
    if not hello or not hello.get('ok'):
        raise RuntimeError(f'Node {mid} rejected by backend: {hello}')
    await heartbeat(client,node)
    dist=distance_km(EPICENTER,(node['lat'],node['lon']))
    p_ms=origin_ms+int(dist/6.0*1000)
    s_ms=origin_ms+int(dist/3.5*1000)
    capture_start=origin_ms-10000
    event_id=1
    started = await client.call('event_start',{
        'module_id':mid,'gateway_boot_id':BOOT,'event_id':event_id,'event_group_id':GROUP,
        'capture_started_at_unix_ms':capture_start,'detected_at_unix_ms':origin_ms,
        'origin_time_unix_ms':origin_ms,'p_arrival_unix_ms':p_ms,'s_arrival_unix_ms':s_ms,
        'expected_samples':SAMPLE_COUNT,'trigger_rms_mg':42,'time_synced':True,'time_quality':'simulated_clock',
        'magnitude_estimate':3.8,'affected_radius_km':12.0,'simulated':True
    }, timeout=15)
    if not started or not started.get('ok'):
        raise RuntimeError(f'Node {mid} event_start failed: {started}')
    p_rel=(p_ms-capture_start)/1000.0; s_rel=(s_ms-capture_start)/1000.0
    batch=[]
    sent=0
    for i in range(SAMPLE_COUNT):
        t=i/SAMPLE_RATE
        x,y,z=waveform(t,p_rel,s_rel,mid/1000)
        sample_time=capture_start+i*10
        batch.append({
            'module_id':mid,'gateway_boot_id':BOOT,'event_id':event_id,'sample_index':i,
            'timestamp_ms':i*10,'device_uptime_ms':i*10,'unix_time_ms':sample_time,
            'time_synced':True,'time_quality':'simulated_clock',
            'raw_x':int(x*256),'raw_y':int(y*256),'raw_z':int(z*256),
            'x_g':round(x,6),'y_g':round(y,6),'z_g':round(z,6)
        })
        if len(batch) == 100 or i == SAMPLE_COUNT-1:
            ack=await client.call('sensor_data_batch',{'module_id':mid,'gateway_boot_id':BOOT,'event_id':event_id,'samples':batch},timeout=30)
            if not ack or not ack.get('ok') or ack.get('accepted') != len(batch):
                raise RuntimeError(f'Node {mid} sample batch failed at sample {sent}: {ack}')
            sent += len(batch)
            batch=[]
            await asyncio.sleep(0.001 / max(SPEED,1))
    print(f'[SIM] Node {mid}: backend acknowledged {sent}/{SAMPLE_COUNT} samples',flush=True)
    ended = await client.call('event_end',{
        'module_id':mid,'gateway_boot_id':BOOT,'event_id':event_id,'total_samples':SAMPLE_COUNT,
        'received_samples':SAMPLE_COUNT,'missing_samples':0,'duration_ms':SAMPLE_COUNT*10,
        'capture_ended_at_unix_ms':capture_start+(SAMPLE_COUNT-1)*10,'trigger_rms_mg':42,'end_reason':0
    }, timeout=60)
    if not ended or not ended.get('ok') or ended.get('received_samples') != SAMPLE_COUNT:
        raise RuntimeError(f'Node {mid} event_end did not confirm full persistence: {ended}')
    print(f'[SIM] Node {mid}: event persisted ({ended["received_samples"]} samples)',flush=True)
    await heartbeat(client,node,False)
    await asyncio.sleep(1)
    await client.disconnect()

async def main():
    print(f'[SIM] Connecting to {URL}; group={GROUP}; speed={SPEED}x; samples/node={SAMPLE_COUNT}',flush=True)
    origin_ms=int(time.time()*1000)+2000
    await asyncio.gather(*(run_node(n,origin_ms) for n in NODES))
    print('[SIM] Scenario complete. Select the new event on the map to inspect its waveform and infrastructure.',flush=True)

if __name__=='__main__': asyncio.run(main())
