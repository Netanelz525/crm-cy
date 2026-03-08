const API_URL = process.env.TWENTY_API_URL || "https://api.twenty.com/graphql";
const API_TOKEN = process.env.TWENTY_API_TOKEN;

if (!API_TOKEN) {
  throw new Error("Missing TWENTY_API_TOKEN env variable.");
}

const SEARCH_QUERY = `
query Search($searchInput: String!, $limit: Int!, $excludedObjectNameSingulars: [String!], $includedObjectNameSingulars: [String!]) {
  search(
    searchInput: $searchInput
    limit: $limit
    excludedObjectNameSingulars: $excludedObjectNameSingulars
    includedObjectNameSingulars: $includedObjectNameSingulars
  ) {
    edges {
      node {
        recordId
        objectNameSingular
        label
      }
    }
  }
}
`;

const STUDENTS_BY_INSTITUTION_QUERY = `
query StudentsByInstitution($currentInstitution: StudentCurrentInstitutionEnum!, $first: Int!, $after: String) {
  students(first: $first, after: $after, filter: { currentInstitution: { eq: $currentInstitution } }) {
    edges {
      node {
        id
        name
        tznum
        class
        dateofbirth
        fullName { firstName lastName }
        phone { primaryPhoneNumber primaryPhoneCallingCode }
        dadPhone { primaryPhoneNumber primaryPhoneCallingCode }
        momPhone { primaryPhoneNumber primaryPhoneCallingCode }
        currentInstitution
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

const STUDENTS_BY_TZ_QUERY = `
query StudentsByTz($tznum: String!, $first: Int!) {
  students(first: $first, filter: { tznum: { eq: $tznum } }) {
    edges {
      node {
        id
        name
        tznum
        class
        dateofbirth
        fullName { firstName lastName }
        phone { primaryPhoneNumber primaryPhoneCallingCode }
        dadPhone { primaryPhoneNumber primaryPhoneCallingCode }
        momPhone { primaryPhoneNumber primaryPhoneCallingCode }
      }
    }
  }
}
`;

const STUDENT_BY_ID_QUERY = `
query StudentById($id: UUID!) {
  student(filter: { id: { eq: $id } }) {
    id
    name
    tznum
    class
    dateofbirth
    currentInstitution
    registration
    note
    fullName { firstName lastName }
    phone { primaryPhoneNumber primaryPhoneCallingCode }
    dadPhone { primaryPhoneNumber primaryPhoneCallingCode }
    momPhone { primaryPhoneNumber primaryPhoneCallingCode }
    email { primaryEmail }
    fatherEmail { primaryEmail }
    motherEmail { primaryEmail }
  }
}
`;

const STUDENT_BY_EMAIL_QUERY = `
query StudentByEmail($email: String!, $first: Int!) {
  students(first: $first, filter: { email: { primaryEmail: { eq: $email } } }) {
    edges {
      node {
        id
        name
        class
        tznum
        dateofbirth
        fullName { firstName lastName }
        email { primaryEmail }
      }
    }
  }
}
`;

async function gql(query, variables = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store"
  });
  const body = await res.json();
  if (!res.ok || body.errors?.length) {
    throw new Error(body.errors?.map((e) => e.message).join(" | ") || `HTTP ${res.status}`);
  }
  return body.data;
}

function mapNode(node) {
  const directLabel = String(node?.label || "").trim();
  const first = String(node?.fullName?.firstName || "").trim();
  const last = String(node?.fullName?.lastName || "").trim();
  const label =
    directLabel ||
    `${first} ${last}`.trim() ||
    String(node?.name || "").trim() ||
    "ללא שם";
  return {
    id: node.id || node.recordId,
    objectName: node.objectNameSingular || "student",
    label,
    tznum: node?.tznum || "",
    class: node?.class || "",
    dateofbirth: node?.dateofbirth || "",
    currentInstitution: node?.currentInstitution || "",
    phone: node?.phone || null,
    dadPhone: node?.dadPhone || null,
    momPhone: node?.momPhone || null
  };
}

export async function searchStudentsByText(q) {
  if (!q) return [];
  const data = await gql(SEARCH_QUERY, {
    searchInput: q,
    limit: 50,
    excludedObjectNameSingulars: ["workspaceMember"],
    includedObjectNameSingulars: ["student"]
  });
  const edges = data?.search?.edges || [];
  return edges.map((e) => mapNode(e.node));
}

export async function searchStudentsByTz(tznum) {
  if (!tznum) return [];
  const data = await gql(STUDENTS_BY_TZ_QUERY, { tznum, first: 50 });
  const edges = data?.students?.edges || [];
  return edges.map((e) => mapNode(e.node));
}

export async function getStudentsByInstitution(institution) {
  if (!institution) return [];
  const out = [];
  let after = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await gql(STUDENTS_BY_INSTITUTION_QUERY, {
      currentInstitution: institution,
      first: 200,
      after
    });
    const connection = data?.students;
    const edges = connection?.edges || [];
    out.push(...edges.map((e) => mapNode(e.node)));
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
    if (!hasNextPage || !after) break;
  }

  return out;
}

export async function getStudentById(id) {
  const data = await gql(STUDENT_BY_ID_QUERY, { id });
  return data?.student || null;
}

export async function getStudentByPrimaryEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  try {
    const data = await gql(STUDENT_BY_EMAIL_QUERY, { email: normalizedEmail, first: 5 });
    const edges = data?.students?.edges || [];
    const exact = edges.find(
      (e) => String(e?.node?.email?.primaryEmail || "").trim().toLowerCase() === normalizedEmail
    );
    const first = exact || edges[0];
    return first?.node || null;
  } catch {
    return null;
  }
}
