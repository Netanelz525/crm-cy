import { buildInstitutionCsvExport, buildInstitutionPdfExport } from './lib/institution-exports.js';

const query = new URLSearchParams([
  ['source','neon'],
  ['mode','institution'],
  ['institutionSearch',''],
  ['quickRegistration','DATOT'],
  ['quickRegistration','NOT_ELIGIBLE'],
  ['pdfOrientation','portrait'],
  ['sby','class'],
  ['sdir','asc'],
  ['sby','name'],
  ['sdir','asc'],
  ['missingType',''],
  ['cols','name'],
  ['cols','tznum'],
  ['cols','age'],
  ['cols','studentPhone'],
  ['cols','dadPhone'],
  ['cols','missing'],
  ['cols','field:adders.addressStreet1'],
  ['cols','field:adders.addressCity'],
]);

for (const [label, fn] of [['xlsx', buildInstitutionCsvExport], ['pdf', buildInstitutionPdfExport]]) {
  try {
    const result = await fn(query);
    console.log(label, 'ok', result.filename, result.contentType, result.content?.length || result.content?.byteLength || 0);
  } catch (error) {
    console.error(label, 'error');
    console.error(error && error.stack || error);
  }
}
