'use client';

import {useEffect, useRef, useState} from 'react';
import {collection, onSnapshot} from 'firebase/firestore';
import {db} from '../../lib/firebase';
import {useAuth} from '../../contexts/AuthContext';
import {ADMIN_UID, saveUserAccess} from '../../lib/userAccess';

export default function UsuariosPage() {
  const {currentUser} = useAuth();
  const isAdmin = currentUser?.uid === ADMIN_UID;
  const [users,setUsers] = useState([]);
  const [form,setForm] = useState({uid:'',email:'',name:''});
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [message,setMessage] = useState('');
  const busy = useRef(false);
  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(collection(db,'authorized_users'), snapshot => {
      setUsers(snapshot.docs.map(item => ({uid:item.id,...item.data()})).sort((a,b)=>(a.name || a.uid).localeCompare(b.name || b.uid)));
      setLoading(false);
    }, () => {setMessage('No se pudo cargar la lista de accesos.');setLoading(false);});
  }, [isAdmin]);
  async function save(entry) {
    if (busy.current) return;
    busy.current=true;setSaving(true);setMessage('');
    try {await saveUserAccess(db,currentUser,entry);setMessage('Acceso actualizado y registrado en el historial.');if(entry.isNew)setForm({uid:'',email:'',name:''});}
    catch(error){setMessage(error.message);}
    finally{busy.current=false;setSaving(false);}
  }
  if (!isAdmin) return <div className="page-container"><h1 className="page-title">Usuarios autorizados</h1><p>Solo Franco puede administrar los accesos.</p></div>;
  return <div className="page-container">
    <div className="page-header"><h1 className="page-title">Usuarios autorizados</h1><p className="page-description">Autoriza cuentas existentes para consultar inventario y registrar conteos. Franco y M. Silva conservan sus permisos de edición.</p></div>
    {message && <div role="status" className="alert alert-secondary">{message}</div>}
    <form className="card p-4 mb-4" onSubmit={event=>{event.preventDefault();save({...form,enabled:true,isNew:true});}}>
      <h2 className="h5">Autorizar una cuenta</h2>
      <p className="text-secondary">Copia el UID exacto desde Firebase Authentication. Este formulario concede acceso; la cuenta debe estar creada previamente.</p>
      <div className="row g-3">
        {[['name','Nombre',200],['email','Correo',254],['uid','UID de Firebase',128]].map(([field,label,max])=><div className="col-md-4" key={field}><label htmlFor={`access-${field}`} className="form-label">{label}</label><input id={`access-${field}`} className="form-control" type={field==='email'?'email':'text'} required maxLength={max} value={form[field]} onChange={event=>setForm(previous=>({...previous,[field]:event.target.value}))} /></div>)}
      </div>
      <button className="btn btn-primary mt-3 align-self-start" disabled={saving} type="submit">{saving?'Guardando…':'Autorizar acceso'}</button>
    </form>
    <div className="card p-4"><h2 className="h5">Accesos de consulta</h2>
      {loading?<p>Cargando…</p>:users.length===0?<p className="text-secondary">Todavía no hay cuentas de consulta autorizadas.</p>:<div className="table-responsive"><table className="table align-middle"><thead><tr><th>Usuario</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{users.map(entry=><tr key={entry.uid}><td><strong>{entry.name || entry.uid}</strong><div className="text-secondary">{entry.email}</div><small className="text-secondary">{entry.uid}</small></td><td>{entry.enabled?'Autorizado':'Revocado'}</td><td><button className="btn btn-secondary btn-sm" disabled={saving || !entry.email || !entry.name} onClick={()=>{if(window.confirm(`${entry.enabled?'Revocar':'Restablecer'} acceso de ${entry.email}?`))save({...entry,expectedEnabled:entry.enabled,enabled:!entry.enabled});}}>{entry.enabled?'Revocar':'Restablecer'}</button></td></tr>)}</tbody></table></div>}
    </div>
  </div>;
}
