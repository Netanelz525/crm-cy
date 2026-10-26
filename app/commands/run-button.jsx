'use client';
import { useFormStatus } from 'react-dom';
export default function RunButton(){const {pending}=useFormStatus();return <button className="btn" disabled={pending} type="submit">{pending?'מפעיל…':'הפעל פקודה'}</button>;}
