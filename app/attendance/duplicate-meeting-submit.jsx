'use client';
import {useFormStatus} from 'react-dom';
export default function DuplicateMeetingSubmit(){
  const {pending}=useFormStatus();
  return <button type="submit" className="quick-action-btn quick-action-primary" disabled={pending}>{pending?'יוצר עותק חדש…':'צור עותק חדש'}</button>;
}
