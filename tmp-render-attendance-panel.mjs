import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AttendanceHistoryPanel from './components/attendance-history-panel.jsx';
const html = renderToStaticMarkup(
  React.createElement(AttendanceHistoryPanel, {
    summary: { totalSessions: 1, attendedSessions: 1, found: 1, late: 0, missing: 0, sentHome: 0, attendancePercent: 100 },
    history: [{ sessionId: 's1', studentId: 'st1', sessionTitle: 'סדר א', statusLabel: 'נמצא', institutionLabel: 'חכמי ירושלים', sessionDate: '2026-05-11', studentClassLabel: 'שיעור א', noteText: '' }]
  })
);
console.log(html.slice(0, 1200));
