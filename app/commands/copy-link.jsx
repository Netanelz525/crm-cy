'use client';
import {useState} from 'react';
export default function CopyCommandLink({id}){const[copied,setCopied]=useState(false);return <button type="button" className="btn" onClick={async()=>{try{await navigator.clipboard.writeText(new URL('/commands/'+encodeURIComponent(id),window.location.origin).href);setCopied(true);}catch{setCopied(false);}}}>{copied?'הקישור הועתק':'העתק קישור לפקודה'}</button>;}
