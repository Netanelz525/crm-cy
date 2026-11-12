import {NextResponse} from 'next/server';
import * as XLSX from 'xlsx';
import {getCurrentAppUser} from '../../../../../../../lib/rbac';
import {getAttendanceCallRoster,CallQueueError} from '../../../../../../../lib/attendance-calls';
import {callPhone} from '../../../../../../../lib/call-phone';
export async function GET(request,{params}){
 try{
 const user=await getCurrentAppUser(),{sessionId}=await params,status=new URL(request.url).searchParams.get('status')||'';
 const roster=await getAttendanceCallRoster(sessionId,user,status),labels=new Map(roster.session.statusOptions);
 const rows=roster.students.map(student=>({'שם התלמיד':student.label,'שיעור':student.classLabel||student.class||'','סטטוס נוכחות':labels.get(student.status)||student.status,'טלפון תלמיד':callPhone(student.phone),'טלפון אב':callPhone(student.dadPhone),'טלפון אם':callPhone(student.momPhone)}));
 const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(rows,{header:['שם התלמיד','שיעור','סטטוס נוכחות','טלפון תלמיד','טלפון אב','טלפון אם']});sheet['!cols']=[{wch:28},{wch:16},{wch:20},{wch:20},{wch:20},{wch:20}];workbook.Workbook={Views:[{RTL:true}]};XLSX.utils.book_append_sheet(workbook,sheet,'תלמידים להתקשרות');
 return new NextResponse(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':'attachment; filename="attendance-call-phones.xlsx"','cache-control':'no-store'}});
 }catch(error){return NextResponse.json({error:error instanceof CallQueueError?error.message:'ייצוא הרשימה נכשל.'},{status:error instanceof CallQueueError?error.status:500});}
}
