"use client";

import { useActionState } from "react";
import { createApiTokenAction } from "./actions";

const initialState = {
  ok: false,
  token: "",
  label: "",
  scopes: [],
  message: ""
};

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function DocBlock({ title, children }) {
  return (
    <section className="api-doc-block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export default function ApiAccessClient({ apiBaseUrl }) {
  const [state, formAction, pending] = useActionState(createApiTokenAction, initialState);
  const baseUrl = cleanBaseUrl(apiBaseUrl) || "http://localhost:3000";

  return (
    <div className="card">
      <div className="api-doc-head">
        <div>
          <h2>גישת API ל-Neon CRM</h2>
          <p className="muted">
            הטוקנים כאן עובדים מול ה-API המקומי של ה-CRM ב-Neon, ונבנו כך שבהמשך אפשר יהיה להרחיב אותם גם לאובייקטים נוספים.
          </p>
        </div>
        <div className="api-doc-badge">Students API</div>
      </div>

      <form action={formAction} className="grid">
        <input name="label" placeholder="שם פנימי לטוקן" />
        <select name="resource" defaultValue="students">
          <option value="students">students</option>
          <option value="backup">backup</option>
        </select>
        <select name="access" defaultValue="read">
          <option value="read">read</option>
          <option value="write">write</option>
          <option value="delete">delete</option>
          <option value="full">full</option>
          <option value="backup">backup</option>
        </select>
        <button type="submit" disabled={pending}>{pending ? "יוצר..." : "צור טוקן API"}</button>
      </form>

      {state.message ? (
        <div className={state.ok ? "ok" : "card muted"} style={{ marginTop: 12 }}>
          <div>{state.message}</div>
          {state.token ? (
            <div style={{ marginTop: 8 }}>
              <b>Token:</b>
              <pre className="token-box">{state.token}</pre>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="api-doc-grid">
        <DocBlock title="ENV">
          <div className="api-env-card">
            <div className="api-env-row">
              <span className="api-env-key">CRM_BASE_URL</span>
              <code className="api-env-value">{baseUrl}</code>
            </div>
            <div className="api-env-row">
              <span className="api-env-key">Base API URL</span>
              <code className="api-env-value">{`${baseUrl}/api/crm`}</code>
            </div>
          </div>
        </DocBlock>

        <DocBlock title="Endpoints">
          <div className="api-endpoint-list">
            <div><code>GET</code> <span>{`${baseUrl}/api/crm/students?q=...&limit=10&offset=0&minScore=0.42`}</span></div>
            <div><code>GET</code> <span>{`${baseUrl}/api/crm/students?institution=CY&limit=20`}</span></div>
            <div><code>GET</code> <span>{`${baseUrl}/api/crm/students/{id}`}</span></div>
            <div><code>GET</code> <span>{`${baseUrl}/api/crm/export?resource=all`}</span></div>
            <div><code>GET</code> <span>{`${baseUrl}/api/crm/export?resource=neon_students`}</span></div>
            <div><code>POST</code> <span>{`${baseUrl}/api/crm/students`}</span></div>
            <div><code>PATCH</code> <span>{`${baseUrl}/api/crm/students/{id}`}</span></div>
            <div><code>DELETE</code> <span>{`${baseUrl}/api/crm/students/{id}`}</span></div>
          </div>
        </DocBlock>

        <DocBlock title="Query Params">
          <div className="api-param-list">
            <div><b>q</b>: חיפוש משוער בשם פרטי/משפחה עם score</div>
            <div><b>institution</b>: סינון לפי מוסד, למשל `CY`</div>
            <div><b>tz</b>: חיפוש לפי ת"ז תלמיד/אב/אם</div>
            <div><b>limit</b>: עד `500` תוצאות</div>
            <div><b>offset</b>: דילוג לפאג'ינציה</div>
            <div><b>minScore</b>: סף התאמה בין `0` ל-`1`, ברירת מחדל `0.42`</div>
          </div>
        </DocBlock>

        <DocBlock title="Response Shape">
          <pre className="token-box">{`{\n  "resource": "students",\n  "count": 2,\n  "total": 51,\n  "limit": 2,\n  "offset": 0,\n  "minScore": 0.42,\n  "names": [\n    { "id": "...", "name": "אברהם כהן", "matchScore": 1 }\n  ],\n  "items": [\n    { "...": "full student objects" }\n  ]\n}`}</pre>
        </DocBlock>

        <DocBlock title="Scopes">
          <div className="api-param-list">
            <div><b>students:read</b>: `GET` list/detail</div>
            <div><b>students:write</b>: `POST` + `PATCH`</div>
            <div><b>students:delete</b>: `DELETE`</div>
            <div><b>backup:read</b>: `GET /api/crm/export`</div>
          </div>
        </DocBlock>

        <DocBlock title="Examples">
          <pre className="token-box">{`curl -H "Authorization: Bearer <TOKEN>" \\\n  "${baseUrl}/api/crm/students?q=כהן&limit=10&minScore=0.55"\n\ncurl -H "Authorization: Bearer <TOKEN>" \\\n  "${baseUrl}/api/crm/students?institution=CY&limit=5"\n\ncurl -H "Authorization: Bearer <BACKUP_TOKEN>" \\\n  "${baseUrl}/api/crm/export?resource=all"\n\ncurl -X POST \\\n  -H "Authorization: Bearer <TOKEN>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"fullName":{"firstName":"אברהם","lastName":"כהן"},"currentInstitution":"CY","class":"A"}' \\\n  "${baseUrl}/api/crm/students"`}</pre>
        </DocBlock>

        <DocBlock title="מגבלות נוכחיות">
          <div className="api-param-list">
            <div>כרגע exposed רק resource של `students`</div>
            <div>הקריאה היא מ-Neon, הכתיבה עדיין מסונכרנת דרך Twenty</div>
            <div>החיפוש המשוער הוא scoring אפליקטיבי, לא full-text index של Postgres</div>
            <div>אין versioning כמו `/api/v1` עדיין</div>
            <div>אין rate limiting</div>
          </div>
        </DocBlock>
      </div>
    </div>
  );
}
