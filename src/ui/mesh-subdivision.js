import * as THREE from 'three';

// Weld positions while keeping face-corner UVs separate, so texture seams survive.
// Linear refinement keeps the existing surface. Loop refinement smooths it.
export function subdivideMesh(source, factor, linear) {
  if (!source?.attributes?.position) return source;
  const requestedFactor = Number(factor);
  const safeFactor = Number.isFinite(requestedFactor)
    ? Math.max(1, Math.min(16, requestedFactor))
    : 1;
  const levels = Math.ceil(Math.log2(safeFactor));
  if (!levels) return source;
  const originalBounds = new THREE.Box3().setFromBufferAttribute(source.attributes.position);
  const positions = [], welded = new Map(), remap = [];
  const position = source.attributes.position, uv = source.attributes.uv, normal = source.attributes.normal;
  for (let i = 0; i < position.count; i++) {
    const p = [position.getX(i),position.getY(i),position.getZ(i)];
    const key = p.map(n => Math.round(n * 1e6)).join(',');
    if (!welded.has(key)) { welded.set(key,positions.length); positions.push(p); }
    remap[i] = welded.get(key);
  }
  let points = positions, faces = [];
  const indices = source.index ? Array.from(source.index.array) : Array.from({length:position.count}, (_,i)=>i);
  for (let i=0;i+2<indices.length;i+=3) {
    const corner = [indices[i],indices[i+1],indices[i+2]];
    const ids = corner.map(j=>remap[j]);
    if (ids.some(id=>!Number.isInteger(id) || id < 0 || id >= positions.length)) continue;
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[2] === ids[0]) continue;
    faces.push({ids, uv:corner.map(j=>uv ? [uv.getX(j),uv.getY(j)] : [0,0]), normals:corner.map(j=>normal ? [normal.getX(j),normal.getY(j),normal.getZ(j)] : [0,1,0])});
  }
  const midpoint = (a,b) => a.map((n,i)=>(n+b[i])/2);
  for (let level=0;level<levels;level++) {
    const edges = new Map(), neighbors = points.map(()=>new Set()), boundaries = points.map(()=>[]);
    const key = (a,b)=>a<b ? `${a}:${b}` : `${b}:${a}`;
    for (const {ids} of faces) for (let k=0;k<3;k++) {
      const a=ids[k], b=ids[(k+1)%3], opposite=ids[(k+2)%3], id=key(a,b);
      if (!edges.has(id)) edges.set(id,{a,b,opposites:[]});
      edges.get(id).opposites.push(opposite);
      neighbors[a].add(b); neighbors[b].add(a);
    }
    for (const {a,b,opposites} of edges.values()) if (opposites.length===1) { boundaries[a].push(b); boundaries[b].push(a); }
    const next = points.map((p,i)=> {
      if (linear) return [...p];
      const boundary=boundaries[i];
      if (boundary.length===2) return p.map((v,k)=>v*.75+(points[boundary[0]][k]+points[boundary[1]][k])*.125);
      const adjacent=[...neighbors[i]];
      const n=adjacent.length;
      if (!n) return [...p];
      const beta=n===3 ? 3/16 : 3/(8*n);
      const sum=[0,0,0];
      for (const neighbor of adjacent) {
        const point=points[neighbor];
        sum[0]+=point[0]; sum[1]+=point[1]; sum[2]+=point[2];
      }
      return p.map((v,k)=>v*(1-n*beta)+sum[k]*beta);
    });
    for (const edge of edges.values()) {
      const {a,b,opposites}=edge;
      edge.index=next.length;
      next.push(!linear && opposites.length===2 ? points[a].map((v,k)=>(v+points[b][k])*3/8+(points[opposites[0]][k]+points[opposites[1]][k])/8) : midpoint(points[a],points[b]));
    }
    const refined=[];
    for (const face of faces) {
      const [a,b,c]=face.ids, ab=edges.get(key(a,b)).index, bc=edges.get(key(b,c)).index, ca=edges.get(key(c,a)).index;
      const attrs = property => { const [x,y,z]=face[property]; return [x,y,z,midpoint(x,y),midpoint(y,z),midpoint(z,x)]; };
      const u=attrs('uv'), n=attrs('normals');
      for (const [ids, corners] of [[[a,ab,ca],[0,3,5]],[[ab,b,bc],[3,1,4]],[[ca,bc,c],[5,4,2]],[[ab,bc,ca],[3,4,5]]]) refined.push({ids,uv:corners.map(i=>u[i]),normals:corners.map(i=>n[i])});
    }
    points=next; faces=refined;
  }
  // Keep the dimensions entered in the toolbar stable after smoothing.
  const bounds = new THREE.Box3().setFromPoints(points.map(p=>new THREE.Vector3(...p)));
  const before = originalBounds.getSize(new THREE.Vector3()).toArray(), after = bounds.getSize(new THREE.Vector3()).toArray();
  const center = bounds.getCenter(new THREE.Vector3()).toArray(), originalCenter = originalBounds.getCenter(new THREE.Vector3()).toArray();
  if (!linear) points = points.map(p=>p.map((v,k)=>after[k]>1e-8 ? (v-center[k])*before[k]/after[k]+originalCenter[k] : v));
  const smoothNormals=points.map(()=>new THREE.Vector3());
  if (!linear) for (const {ids:[a,b,c]} of faces) {
    const pa=points[a], pb=points[b], pc=points[c];
    const abx=pb[0]-pa[0], aby=pb[1]-pa[1], abz=pb[2]-pa[2];
    const acx=pc[0]-pa[0], acy=pc[1]-pa[1], acz=pc[2]-pa[2];
    const nx=aby*acz-abz*acy, ny=abz*acx-abx*acz, nz=abx*acy-aby*acx;
    for (const i of [a,b,c]) {
      smoothNormals[i].x+=nx; smoothNormals[i].y+=ny; smoothNormals[i].z+=nz;
    }
  }
  const p=[], u=[], n=[];
  for (const face of faces) face.ids.forEach((id,i)=> {
    const point=points[id], texcoord=face.uv[i];
    p.push(point[0],point[1],point[2]); u.push(texcoord[0],texcoord[1]);
    const normal=linear ? face.normals[i] : smoothNormals[id];
    const nx=linear ? normal[0] : normal.x, ny=linear ? normal[1] : normal.y, nz=linear ? normal[2] : normal.z;
    const length=Math.hypot(nx,ny,nz) || 1;
    n.push(nx/length,ny/length,nz/length);
  });
  const result=new THREE.BufferGeometry();
  result.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  result.setAttribute('uv',new THREE.Float32BufferAttribute(u,2));
  result.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));
  source.dispose();
  return result;
}
