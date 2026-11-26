// Borrado definitivo de las empresas de prueba TMK, Naturquea y Demo Revisión (pedido por Mario el 2026-11-25).
// Copia previa en supabase/datos/respaldo-empresas-borradas-2026-11-25/filas.json. Reproduce la acción
// borrarEmpresaDefinitivaSafeAction: baja → RPC borrar_empresa_definitiva → Storage → Auth.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'')]));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const EMPRESAS=['2490b0ed-1de9-4af9-ae00-68cc128f4ff7','115bdfe1-558e-45cc-9aff-5031398b9485','8902c459-0f2e-45e9-9c19-a7e4e6ee10e2'];
const { data: sa, error: eSa } = await admin.from('superadmins').select('user_id').limit(1);
if (eSa || !sa?.length) throw new Error('Sin superadmin: '+JSON.stringify(eSa));
const actor=sa[0].user_id;
for (const id of EMPRESAS) {
  const { data: emp } = await admin.from('companies').select('id,name,status,protegida').eq('id',id).maybeSingle();
  if (!emp) { console.log(id,'ya no existe'); continue; }
  if (emp.protegida) throw new Error('PROTEGIDA: '+emp.name);
  if (emp.status!=='cancelled') { const { error } = await admin.from('companies').update({status:'cancelled',cancelled_at:new Date().toISOString()}).eq('id',id); if (error) throw error; }
  const { data: r, error } = await admin.rpc('borrar_empresa_definitiva',{p_company_id:id,p_confirmar_nombre:emp.name,p_actor:actor});
  if (error) throw new Error(emp.name+': '+JSON.stringify(error));
  const filas=Object.values(r?.filas??{}).reduce((s,n)=>s+Number(n||0),0);
  const fich=(r?.ficheros??[]).filter(f=>f.bucket&&f.name?.startsWith(id+'/'));
  const porBucket={}; for (const f of fich) (porBucket[f.bucket]??=[]).push(f.name);
  let fOk=0; for (const [b,rutas] of Object.entries(porBucket)) for (let i=0;i<rutas.length;i+=100){ const { data, error: e } = await admin.storage.from(b).remove(rutas.slice(i,i+100)); if (e) console.error('storage',b,e.message); else fOk+=data.length; }
  let uOk=0; const uMal=[]; for (const uid of (r?.usuarios??[])) { if (uid===actor) continue; const { error: e } = await admin.auth.admin.deleteUser(uid); if (e) uMal.push(uid+':'+e.message); else uOk++; }
  console.log(`${emp.name}: filas ${filas}, ficheros ${fOk}/${fich.length}, cuentas ${uOk}/${(r?.usuarios??[]).length}`, uMal.length?uMal:'');
}
