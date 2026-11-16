from __future__ import annotations
import asyncio, gzip, json, os, secrets, uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import socketio
from fastapi import FastAPI, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from database import db
from seismo.security import hash_password, verify_password, create_token, read_token
from seismo.analysis import analyze_samples

WAVEFORM_DIR = Path(os.getenv('WAVEFORM_DIR', '/data/waveforms'))

def json_value(value):
    if isinstance(value, str):
        try: return json.loads(value)
        except Exception: return value
    return value
WAVEFORM_DIR.mkdir(parents=True, exist_ok=True)
OFFLINE_SECONDS = int(os.getenv('OFFLINE_SECONDS', '5'))
ACTIVE: dict[str, dict[str, Any]] = {}
EVENT_KEYS: dict[tuple, str] = {}
EVENT_LOCKS: dict[str, asyncio.Lock] = {}

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*', logger=False, engineio_logger=False)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    async with db.acquire() as conn:
        username = os.getenv('ADMIN_USERNAME', 'admin')
        password = os.getenv('ADMIN_PASSWORD', 'ChangeMe123!')
        row = await conn.fetchrow('SELECT id FROM users WHERE username=$1', username)
        if not row:
            await conn.execute('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3)', username, hash_password(password), 'admin')
        # Physical node 4097 is known to the gateway; coordinates are intentionally unset until admin registers them.
        key = os.getenv('NODE_4097_KEY') or secrets.token_urlsafe(32)
        await conn.execute("""INSERT INTO nodes(module_id,name,auth_key,source) VALUES(4097,'Physical Seismograph 4097',$1,'physical') ON CONFLICT(module_id) DO NOTHING""", key)
        await conn.execute("INSERT INTO system_logs(event_type,description) VALUES('System','SeismoLink backend started')")
        if os.getenv('SEED_DEMO_NODES', 'true').lower() == 'true':
            demo_nodes = [
                (4101, 'Demo Node North', 30.3450, 78.0350),
                (4102, 'Demo Node South-East', 30.2850, 78.0900),
                (4103, 'Demo Node West', 30.3100, 77.9750),
            ]
            for mid, name, lat, lon in demo_nodes:
                await conn.execute("""INSERT INTO nodes(module_id,name,latitude,longitude,location_description,auth_key,source)
                VALUES($1,$2,$3,$4,'Sample demonstration coordinates', $5, 'simulated') ON CONFLICT(module_id) DO NOTHING""", mid, name, lat, lon, os.getenv(f'SIM_NODE_{mid}_KEY') or secrets.token_urlsafe(32))
    monitor_task = asyncio.create_task(offline_monitor())
    try:
        yield
    finally:
        monitor_task.cancel()
        try: await monitor_task
        except asyncio.CancelledError: pass
        await db.close()

api = FastAPI(title='SeismoLink API', version='2.0.0', lifespan=lifespan)
api.add_middleware(CORSMiddleware, allow_origins=os.getenv('CORS_ORIGINS','*').split(','), allow_credentials=True, allow_methods=['*'], allow_headers=['*'])

class LoginBody(BaseModel):
    username: str
    password: str
class NodeBody(BaseModel):
    module_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=100)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    location_description: str = ''
    source: str = 'physical'

async def admin_user(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Admin login required')
    username = read_token(authorization[7:])
    if not username: raise HTTPException(401, 'Invalid or expired token')
    async with db.acquire() as conn:
        row = await conn.fetchrow('SELECT username,role FROM users WHERE username=$1', username)
    if not row: raise HTTPException(401, 'Unknown account')
    return dict(row)

async def log_event(kind: str, description: str):
    async with db.acquire() as conn:
        await conn.execute('INSERT INTO system_logs(event_type,description) VALUES($1,$2)', kind, description)

@api.get('/')
async def root(): return {'name':'SeismoLink','version':'2.0.0','docs':'/docs','socketio':'/socket.io'}
@api.get('/health')
async def health():
    try:
        async with db.acquire() as conn: await conn.execute('SELECT 1')
        return {'status':'healthy','database':'connected','socketio':'enabled'}
    except Exception as e: return {'status':'unhealthy','database':'error','detail':str(e)}

@api.post('/api/v1/auth/login')
async def login(body: LoginBody):
    async with db.acquire() as conn: row = await conn.fetchrow('SELECT username,password_hash,role FROM users WHERE username=$1', body.username)
    if not row or not verify_password(body.password, row['password_hash']): raise HTTPException(401, 'Incorrect username or password')
    return {'access_token':create_token(row['username']), 'token_type':'bearer', 'username':row['username'], 'role':row['role']}

@api.get('/api/v1/nodes')
async def list_nodes():
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT module_id,name,latitude,longitude,location_description,source,status,last_seen,last_reading,firmware FROM nodes ORDER BY module_id")
    return {'nodes':[{**dict(r), 'last_reading':json_value(r['last_reading'])} for r in rows]}

@api.post('/api/v1/nodes')
async def register_node(body: NodeBody, user=Depends(admin_user)):
    if body.source not in ('physical','simulated'): raise HTTPException(400,'source must be physical or simulated')
    generated_key = secrets.token_urlsafe(32)
    async with db.acquire() as conn:
        existing = await conn.fetchrow('SELECT auth_key FROM nodes WHERE module_id=$1', body.module_id)
        await conn.execute("""INSERT INTO nodes(module_id,name,latitude,longitude,location_description,auth_key,source,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,'offline') ON CONFLICT(module_id) DO UPDATE SET name=EXCLUDED.name,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,location_description=EXCLUDED.location_description,source=EXCLUDED.source,updated_at=NOW()""",
        body.module_id,body.name,body.latitude,body.longitude,body.location_description,generated_key,body.source)
        node_key = existing['auth_key'] if existing else generated_key
    await log_event('Node',f"Node {body.module_id} registered/updated by {user['username']}")
    return {'module_id':body.module_id,'auth_key':node_key,'key_rotated':existing is None,'message':'Node updated; existing authentication key was retained.' if existing else 'Node registered. Store this authentication key securely; it is shown only once.'}

@api.delete('/api/v1/nodes/{module_id}')
async def delete_node(module_id: int, user=Depends(admin_user)):
    if module_id == 4097: raise HTTPException(400,'The physical gateway record cannot be deleted; edit it instead.')
    async with db.acquire() as conn:
        result = await conn.execute('DELETE FROM nodes WHERE module_id=$1',module_id)
    await log_event('Node',f'Node {module_id} deleted by {user["username"]}')
    return {'deleted':result.endswith('1')}

@api.get('/api/v1/events')
async def list_events(limit: int = Query(50, ge=1, le=200)):
    async with db.acquire() as conn:
        rows = await conn.fetch('''SELECT e.*,n.name AS node_name,n.latitude AS node_latitude,n.longitude AS node_longitude
        FROM seismic_events e JOIN nodes n USING(module_id) ORDER BY e.detected_at DESC NULLS LAST LIMIT $1''',limit)
    return {'events':[{**dict(r), 'analysis':json_value(r['analysis'])} for r in rows]}

@api.get('/api/v1/events/{event_id}')
async def get_event(event_id: str):
    async with db.acquire() as conn:
        row = await conn.fetchrow('''SELECT e.*,n.name AS node_name,n.latitude AS node_latitude,n.longitude AS node_longitude
        FROM seismic_events e JOIN nodes n USING(module_id) WHERE e.id=$1::uuid''',event_id)
    if not row: raise HTTPException(404,'Event not found')
    result = dict(row)
    result['analysis'] = json_value(result.get('analysis'))
    path = result.get('waveform_path')
    if path and Path(path).exists():
        with gzip.open(path,'rt',encoding='utf-8') as f: result['waveform'] = [json.loads(line) for line in f]
    else: result['waveform'] = []
    return result

@api.delete('/api/v1/events/{event_id}')
async def delete_event(event_id: str, user=Depends(admin_user)):
    async with db.acquire() as conn:
        row=await conn.fetchrow('SELECT waveform_path FROM seismic_events WHERE id=$1::uuid',event_id)
        if not row: raise HTTPException(404,'Event not found')
        path=row['waveform_path']
        await conn.execute('DELETE FROM seismic_events WHERE id=$1::uuid',event_id)
    if path:
        try: Path(path).unlink(missing_ok=True)
        except OSError: pass
    await log_event('Seismic Event',f'Event {event_id} manually deleted by {user["username"]}')
    return {'deleted':True,'event_id':event_id}

@api.get('/api/v1/system-logs')
async def system_logs(limit: int = Query(100,ge=1,le=500)):
    async with db.acquire() as conn: rows = await conn.fetch('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT $1',limit)
    return {'logs':[dict(r) for r in rows]}

async def fetch_infrastructure(event: dict, radius_km: float | None):
    analysis=json_value(event.get('analysis')) or {}
    lat, lon = analysis.get('epicenter_latitude'), analysis.get('epicenter_longitude')
    if lat is None or lon is None: raise HTTPException(409,'This event does not have an estimated epicenter yet.')
    if radius_km is None: radius_km=analysis.get('affected_radius_km')
    if radius_km is None: raise HTTPException(409,'No affected-region estimate is available for this event yet.')
    radius = min(max(float(radius_km), 0.5), 50.0) * 1000
    # Cached data is returned for this event region when available; Overpass is queried only on selection.
    async with db.acquire() as conn:
        cached = await conn.fetch('''SELECT * FROM infrastructure_cache WHERE
          abs(latitude-$1)<=$2/111000 AND abs(longitude-$3)<=$2/(111000*greatest(cos(radians($1)),0.2))
          AND fetched_at > NOW() - INTERVAL '30 days' ''',lat, radius, lon)
    if cached: return [{**dict(r), 'tags':json_value(r['tags'])} for r in cached]
    query = f'''[out:json][timeout:25];(node(around:{int(radius)},{lat},{lon})[amenity~"hospital|clinic|school|university|police|fire_station|shelter"];way(around:{int(radius)},{lat},{lon})[amenity~"hospital|clinic|school|university|police|fire_station|shelter"];node(around:{int(radius)},{lat},{lon})[bridge];way(around:{int(radius)},{lat},{lon})[bridge];way(around:{int(radius)},{lat},{lon})[highway~"primary|secondary|trunk"];);out center tags;'''
    try:
        async with httpx.AsyncClient(timeout=35,headers={'User-Agent':'SeismoLink-Educational/1.0'}) as client:
            response = await client.post('https://overpass-api.de/api/interpreter',data={'data':query})
            response.raise_for_status(); elements = response.json().get('elements',[])
    except Exception as e:
        raise HTTPException(502,f'OpenStreetMap Overpass query failed: {e}')
    items=[]
    for el in elements:
        tags=el.get('tags',{}); center=el.get('center',el)
        if 'lat' not in center or 'lon' not in center: continue
        amenity=tags.get('amenity') or ('bridge' if 'bridge' in tags else 'road' if 'highway' in tags else 'infrastructure')
        category = 'hospital' if amenity in ('hospital','clinic') else 'education' if amenity in ('school','university') else 'emergency' if amenity in ('police','fire_station') else 'bridge' if amenity=='bridge' else 'road' if amenity=='road' else 'shelter'
        items.append({'osm_id':f"{el.get('type','node')}/{el['id']}",'name':tags.get('name') or f'Unnamed {category}','category':category,'amenity_type':amenity,'latitude':center['lat'],'longitude':center['lon'],'tags':tags})
    if items:
        async with db.acquire() as conn:
            for it in items:
                await conn.execute('''INSERT INTO infrastructure_cache(osm_id,name,category,amenity_type,latitude,longitude,tags)
                VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(osm_id) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,tags=EXCLUDED.tags,fetched_at=NOW()''',it['osm_id'],it['name'],it['category'],it['amenity_type'],it['latitude'],it['longitude'],json.dumps(it['tags']))
    return items

@api.get('/api/v1/events/{event_id}/infrastructure')
async def event_infrastructure(event_id: str, radius_km: float | None = Query(None,gt=0,le=50)):
    async with db.acquire() as conn: row=await conn.fetchrow('SELECT * FROM seismic_events WHERE id=$1::uuid',event_id)
    if not row: raise HTTPException(404,'Event not found')
    event=dict(row); items=await fetch_infrastructure(event,radius_km)
    # The proximity result is descriptive, not a damage or shaking-intensity prediction.
    return {'event_id':event_id,'radius_km':radius_km or (json_value(event.get('analysis')) or {}).get('affected_radius_km'),'infrastructure':items,'interpretation':'Potentially exposed infrastructure within the selected analysis radius; not a damage assessment.'}

async def broadcast_nodes():
    async with db.acquire() as conn: rows=await conn.fetch('SELECT module_id,name,latitude,longitude,location_description,source,status,last_seen,last_reading,firmware FROM nodes ORDER BY module_id')
    nodes=[]
    for row in rows:
        item={**dict(row), 'last_reading':json_value(row['last_reading'])}
        if item.get('last_seen'): item['last_seen']=item['last_seen'].isoformat()
        nodes.append(item)
    await sio.emit('nodes_snapshot',{'nodes':nodes})

async def registered_node(module_id: int):
    async with db.acquire() as conn: row=await conn.fetchrow('SELECT * FROM nodes WHERE module_id=$1',module_id)
    return dict(row) if row else None

async def session_owns_node(sid: str, module_id: int) -> bool:
    try:
        session=await sio.get_session(sid)
        return int(session.get('module_id',-1)) == int(module_id)
    except Exception:
        return False

@sio.event
async def connect(sid, environ, auth=None):
    await sio.emit('server_ready',{'message':'Connected to SeismoLink live channel'},to=sid)

@sio.event
async def disconnect(sid, reason=None): pass

@sio.on('gateway_hello')
async def gateway_hello(sid, data):
    module_id=int(data.get('module_id',0)); node=await registered_node(module_id)
    if not node:
        await sio.emit('gateway_rejected',{'reason':'Node is not registered. Ask an admin to register it.'},to=sid); return {'ok':False,'reason':'node_not_registered'}
    # Existing gateway firmware sends module_id but not node_key. Key validation becomes mandatory when sent.
    supplied=data.get('node_key')
    if supplied and not secrets.compare_digest(str(supplied),str(node['auth_key'])):
        await sio.emit('gateway_rejected',{'reason':'Invalid node authentication key'},to=sid); return {'ok':False,'reason':'invalid_node_key'}
    await sio.save_session(sid,{'module_id':module_id,'source':node['source'],'boot_id':data.get('gateway_boot_id')})
    async with db.acquire() as conn:
        await conn.execute("UPDATE nodes SET status='online',last_seen=NOW(),firmware=$2,updated_at=NOW() WHERE module_id=$1",module_id,data.get('firmware'))
    await sio.emit('node_status',{'module_id':module_id,'status':'online','source':node['source']},skip_sid=sid)
    await broadcast_nodes()
    await log_event('Node',f'Node {module_id} connected ({node["source"]})')
    return {'ok':True,'module_id':module_id,'source':node['source']}

@sio.on('sensor_heartbeat')
async def sensor_heartbeat(sid,data):
    module_id=int(data.get('module_id',0)); node=await registered_node(module_id)
    if not node or not await session_owns_node(sid,module_id): return
    status='event' if data.get('event_active') else 'online'
    async with db.acquire() as conn:
        await conn.execute('UPDATE nodes SET status=$2,last_seen=NOW(),last_reading=last_reading || $3::jsonb,updated_at=NOW() WHERE module_id=$1',module_id,status,json.dumps({'heartbeat':data,'updated_at':datetime.now(timezone.utc).isoformat()}))
    await sio.emit('node_status',{'module_id':module_id,'status':status,'heartbeat':data})

@sio.on('sensor_status')
async def sensor_status(sid,data):
    module_id=int(data.get('module_id',0)); node=await registered_node(module_id)
    if not node or not await session_owns_node(sid,module_id): return
    async with db.acquire() as conn:
        await conn.execute('UPDATE nodes SET last_seen=NOW(),last_reading=last_reading || $2::jsonb WHERE module_id=$1',module_id,json.dumps({'status':data}))
    await sio.emit('node_telemetry',data)

@sio.on('event_start')
async def event_start(sid,data):
    module_id=int(data.get('module_id',0)); node=await registered_node(module_id)
    if not node or not await session_owns_node(sid,module_id): return
    gateway_boot_id=str(data.get('gateway_boot_id') or 'legacy')
    node_event_id=str(data.get('event_id') or uuid.uuid4())
    key=(module_id,gateway_boot_id,node_event_id)
    existing=EVENT_KEYS.get(key)
    if existing:
        return {"ok": True, "event_id": existing, "duplicate": True}
    event_uuid=str(uuid.uuid4())
    started_ms=data.get('capture_started_at_unix_ms') or data.get('unix_time_ms')
    detected_ms=data.get('detected_at_unix_ms') or started_ms
    def from_ms(v): return datetime.fromtimestamp(int(v)/1000,tz=timezone.utc) if v else datetime.now(timezone.utc)
    group_id=str(data.get('event_group_id') or data.get('scenario_id') or '') or None
    event_info={'module_id':module_id,'node_event_id':node_event_id,'group_id':group_id,'source':node['source'],'detected_at':from_ms(detected_ms).isoformat(),'capture_started_at':from_ms(started_ms).isoformat(),'expected_samples':int(data.get('expected_samples',7000)),'samples':[],'meta':data}
    async with db.acquire() as conn:
        await conn.execute('''INSERT INTO seismic_events(id,module_id,node_event_id,group_id,gateway_boot_id,source,status,detected_at,capture_started_at,expected_samples,trigger_rms_mg)
        VALUES($1::uuid,$2,$3,$4,$5,$6,'capturing',$7,$8,$9,$10)''',event_uuid,module_id,node_event_id,group_id,gateway_boot_id,node['source'],from_ms(detected_ms),from_ms(started_ms),event_info['expected_samples'],data.get('trigger_rms_mg'))
        await conn.execute("UPDATE nodes SET status='event',last_seen=NOW() WHERE module_id=$1",module_id)
    ACTIVE[event_uuid]=event_info
    EVENT_KEYS[key]=event_uuid
    EVENT_LOCKS[event_uuid]=asyncio.Lock()
    await sio.emit('event_started',{'event_id':event_uuid,'module_id':module_id,'node_name':node['name'],'latitude':node['latitude'],'longitude':node['longitude'],'source':node['source'],'detected_at':event_info['detected_at']})
    await broadcast_nodes()
    await log_event('Seismic Event',f'Node {module_id} started event {node_event_id}')
    print(f'[socketio] event_start module={module_id} boot={gateway_boot_id} event={node_event_id} expected={event_info["expected_samples"]}',flush=True)
    return {'ok': True, 'event_id': event_uuid, 'expected_samples': event_info['expected_samples']}

@sio.on('sensor_data')
async def sensor_data(sid,data):
    module_id=int(data.get('module_id',0)); node=await registered_node(module_id)
    if not node or not await session_owns_node(sid,module_id): return {'ok': False, 'reason': 'unregistered_or_unauthorized'}
    key=(module_id,str(data.get('gateway_boot_id') or 'legacy'),str(data.get('event_id') or ''))
    event_uuid=EVENT_KEYS.get(key)
    if not event_uuid:
        matches=[v for k,v in EVENT_KEYS.items() if k[0]==module_id and k[2]==str(data.get('event_id') or '') and v in ACTIVE]
        event_uuid=matches[-1] if matches else None
    if not event_uuid or event_uuid not in ACTIVE: return {'ok': False, 'reason': 'event_not_active'}
    lock=EVENT_LOCKS.setdefault(event_uuid,asyncio.Lock())
    async with lock:
        state=ACTIVE.get(event_uuid)
        if state is None: return {'ok': False, 'reason': 'event_already_closed'}
        sample={k:data.get(k) for k in ('sample_index','timestamp_ms','device_uptime_ms','unix_time_ms','time_synced','time_quality','raw_x','raw_y','raw_z','x_g','y_g','z_g')}
        state['samples'].append(sample)
        count=len(state['samples'])
        if count%10==0:
            await sio.emit('event_sample',{'event_id':event_uuid,'module_id':module_id,'sample':sample,'received_samples':count})
            reading={'x_g':sample.get('x_g'),'y_g':sample.get('y_g'),'z_g':sample.get('z_g'),'sample_index':sample.get('sample_index')}
            async with db.acquire() as conn:
                await conn.execute('UPDATE nodes SET last_seen=NOW(),last_reading=$2::jsonb WHERE module_id=$1',module_id,json.dumps(reading))
            await sio.emit('node_telemetry',{'module_id':module_id,'reading':reading})
        return {'ok': True, 'received_samples': count}

@sio.on('sensor_data_batch')
async def sensor_data_batch(sid,data):
    samples=data.get('samples') or []
    if not isinstance(samples,list) or not 1 <= len(samples) <= 250:
        return {'ok':False,'reason':'batch_size_must_be_1_to_250'}
    first=samples[0]
    module_id=int(data.get('module_id') or first.get('module_id',0))
    boot_id=str(data.get('gateway_boot_id') or first.get('gateway_boot_id') or 'legacy')
    node_event_id=str(data.get('event_id') or first.get('event_id') or '')
    if any(int(item.get('module_id',module_id)) != module_id or str(item.get('gateway_boot_id') or boot_id) != boot_id or str(item.get('event_id') or node_event_id) != node_event_id for item in samples):
        return {'ok':False,'reason':'batch_contains_multiple_events_or_nodes'}
    node=await registered_node(module_id)
    if not node or not await session_owns_node(sid,module_id):
        return {'ok':False,'reason':'unregistered_or_unauthorized'}
    key=(module_id,boot_id,node_event_id)
    event_uuid=EVENT_KEYS.get(key)
    if not event_uuid or event_uuid not in ACTIVE:
        print(f'[socketio] rejected sensor_data_batch module={module_id} boot={boot_id} event={node_event_id}: event_not_active',flush=True)
        return {'ok':False,'reason':'event_not_active'}
    lock=EVENT_LOCKS.setdefault(event_uuid,asyncio.Lock())
    async with lock:
        state=ACTIVE.get(event_uuid)
        if state is None: return {'ok':False,'reason':'event_already_closed'}
        accepted=0
        last_sample=None
        for item in samples:
            sample={k:item.get(k) for k in ('sample_index','timestamp_ms','device_uptime_ms','unix_time_ms','time_synced','time_quality','raw_x','raw_y','raw_z','x_g','y_g','z_g')}
            state['samples'].append(sample)
            accepted+=1
            last_sample=sample
            count=len(state['samples'])
            if count%10==0:
                await sio.emit('event_sample',{'event_id':event_uuid,'module_id':module_id,'sample':sample,'received_samples':count})
        if last_sample:
            reading={'x_g':last_sample.get('x_g'),'y_g':last_sample.get('y_g'),'z_g':last_sample.get('z_g'),'sample_index':last_sample.get('sample_index')}
            async with db.acquire() as conn:
                await conn.execute('UPDATE nodes SET last_seen=NOW(),last_reading=$2::jsonb WHERE module_id=$1',module_id,json.dumps(reading))
            await sio.emit('node_telemetry',{'module_id':module_id,'reading':reading})
        print(f'[socketio] sensor_data_batch module={module_id} event={node_event_id} accepted={accepted} total={len(state["samples"])}',flush=True)
        return {'ok':True,'accepted':accepted,'received_samples':len(state['samples'])}

@sio.on('event_end')
async def event_end(sid,data):
    module_id=int(data.get('module_id',0)); node=await registered_node(module_id)
    if not node or not await session_owns_node(sid,module_id): return {'ok':False,'reason':'unregistered_or_unauthorized'}
    node_event_id=str(data.get('event_id') or '')
    boot_id=str(data.get('gateway_boot_id') or 'legacy')
    key=(module_id,boot_id,node_event_id)
    event_uuid=EVENT_KEYS.get(key)
    if not event_uuid:
        matches=[(k,v) for k,v in EVENT_KEYS.items() if k[0]==module_id and k[2]==node_event_id and v in ACTIVE]
        if len(matches)==1: key,event_uuid=matches[0]
        else: return {'ok':False,'reason':'event_not_found_or_ambiguous'}
    lock=EVENT_LOCKS.setdefault(event_uuid,asyncio.Lock())
    async with lock:
        state=ACTIVE.get(event_uuid)
        if not state: return {'ok':True,'event_id':event_uuid,'duplicate':True}
        samples=state['samples']
        expected=int(state.get('expected_samples') or 0)
        analysis=analyze_samples(samples)
        path=WAVEFORM_DIR / f'{event_uuid}.jsonl.gz'
        tmp_path=path.with_suffix(path.suffix+'.tmp')
        try:
            with gzip.open(tmp_path,'wt',encoding='utf-8') as f:
                for sample in samples: f.write(json.dumps(sample,separators=(',',':'))+'\n')
            tmp_path.replace(path)
        except Exception:
            tmp_path.unlink(missing_ok=True)
            raise
        end_ms=data.get('capture_ended_at_unix_ms')
        ended=datetime.fromtimestamp(int(end_ms)/1000,tz=timezone.utc) if end_ms else datetime.now(timezone.utc)
        reported_missing=max(0,int(data.get('missing_samples',0) or 0))
        missing=max(0,expected-len(samples),reported_missing)
        analysis.update({'simulated':node['source']=='simulated','event_group_id':state.get('group_id'),'p_arrival_unix_ms':state['meta'].get('p_arrival_unix_ms'),'s_arrival_unix_ms':state['meta'].get('s_arrival_unix_ms'),'origin_time_unix_ms':state['meta'].get('origin_time_unix_ms'),'magnitude_estimate':state['meta'].get('magnitude_estimate'),'affected_radius_km':state['meta'].get('affected_radius_km')})
        async with db.acquire() as conn:
            await conn.execute("""UPDATE seismic_events SET status='complete',capture_ended_at=$2,received_samples=$3,missing_samples=$4,duration_ms=$5,waveform_path=$6,analysis=$7::jsonb WHERE id=$1::uuid""",event_uuid,ended,len(samples),missing,int(data.get('duration_ms',len(samples)*10) or 0),str(path),json.dumps(analysis))
            await conn.execute("UPDATE nodes SET status='online',last_seen=NOW() WHERE module_id=$1",module_id)
        ACTIVE.pop(event_uuid,None)
        EVENT_LOCKS.pop(event_uuid,None)
        await sio.emit('event_completed',{'event_id':event_uuid,'module_id':module_id,'analysis':analysis,'received_samples':len(samples)})
        await broadcast_nodes()
        await log_event('Seismic Event',f'Node {module_id} completed event {node_event_id}; samples={len(samples)}/{expected}')
        if state.get('group_id'): await estimate_group(state['group_id'])
        print(f'[socketio] event_end module={module_id} event={node_event_id} persisted={len(samples)}/{expected} path={path}',flush=True)
        return {'ok':True,'event_id':event_uuid,'received_samples':len(samples),'expected_samples':expected,'missing_samples':missing,'status':'complete'}

async def estimate_group(group_id: str):
    async with db.acquire() as conn:
        rows=await conn.fetch('''SELECT e.id,e.module_id,e.analysis,n.latitude,n.longitude,n.name FROM seismic_events e JOIN nodes n USING(module_id)
        WHERE e.group_id=$1 AND e.status='complete' AND n.latitude IS NOT NULL AND n.longitude IS NOT NULL''',group_id)
    if len(rows)<2: return
    # Demonstration-grade estimate: P-arrival travel-time grid search with fixed nominal P velocity.
    # For real operation, replace with calibrated local velocity model and validated arrival picks.
    stations=[dict(r) for r in rows]
    p_times=[(json_value(s['analysis']) or {}).get('p_arrival_unix_ms') for s in stations]
    if any(t is None for t in p_times): return
    import math
    lat0=sum(s['latitude'] for s in stations)/len(stations); lon0=sum(s['longitude'] for s in stations)/len(stations)
    km_lat=111.32; km_lon=111.32*max(math.cos(math.radians(lat0)),0.2)
    xs=[(s['longitude']-lon0)*km_lon for s in stations]; ys=[(s['latitude']-lat0)*km_lat for s in stations]
    t0=min(p_times); best=None
    for gx in range(-50,51,2):
        for gy in range(-50,51,2):
            distances=[math.hypot(gx-x,gy-y) for x,y in zip(xs,ys)]
            # Fit origin time as mean residual after nominal P-wave velocity 6 km/s.
            residuals=[(t-t0)/1000-d/6 for t,d in zip(p_times,distances)]
            mean=sum(residuals)/len(residuals)
            error=sum((r-mean)**2 for r in residuals)/len(residuals)
            if best is None or error<best[0]: best=(error,gx,gy)
    _,gx,gy=best; epic_lat=lat0+gy/km_lat; epic_lon=lon0+gx/km_lon
    uncertainty=max(2.0, math.sqrt(best[0])*6 + (20 if len(stations)<3 else 5))
    ids=[str(s['id']) for s in stations]
    async with db.acquire() as conn:
        for eid in ids:
            await conn.execute("UPDATE seismic_events SET analysis=analysis || $2::jsonb WHERE id=$1::uuid",eid,json.dumps({'epicenter_latitude':epic_lat,'epicenter_longitude':epic_lon,'uncertainty_km':round(uncertainty,1),'participating_nodes':len(stations),'location_quality':'preliminary' if len(stations)<3 else 'demo_estimate'}))
    await sio.emit('epicenter_updated',{'group_id':group_id,'latitude':epic_lat,'longitude':epic_lon,'uncertainty_km':round(uncertainty,1),'participating_nodes':len(stations),'quality':'preliminary' if len(stations)<3 else 'demo_estimate','event_ids':ids})

async def offline_monitor():
    while True:
        try:
            async with db.acquire() as conn:
                rows=await conn.fetch("UPDATE nodes SET status='offline' WHERE status IN ('online','event') AND last_seen < NOW() - ($1::text || ' seconds')::interval RETURNING module_id",str(OFFLINE_SECONDS))
            for r in rows: await sio.emit('node_status',{'module_id':r['module_id'],'status':'offline'})
            if rows: await broadcast_nodes()
        except Exception as e: print('[offline monitor]',e,flush=True)
        await asyncio.sleep(2)

socket_app=socketio.ASGIApp(sio,other_asgi_app=api)
