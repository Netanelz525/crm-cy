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
        tzMotherNum
        tzaba
        class
        dateofbirth
        currentInstitution
        registration
        macAddress
        note
        famliystatus
        healthInsurance
        shmHb
        shmHm
        fatherDatebirth
        motherDateBirth
        senif
        bankNum
        accountNum
        fullName { firstName lastName }
        phone { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode additionalPhones }
        dadPhone { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode additionalPhones }
        momPhone { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode additionalPhones }
        email { primaryEmail additionalEmails }
        fatherEmail { primaryEmail additionalEmails }
        motherEmail { primaryEmail additionalEmails }
        adders {
          addressStreet1
          addressStreet2
          addressCity
          addressPostcode
          addressState
          addressCountry
          addressLat
          addressLng
        }
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
        tzMotherNum
        tzaba
        class
        dateofbirth
        currentInstitution
        registration
        macAddress
        note
        famliystatus
        healthInsurance
        shmHb
        shmHm
        fatherDatebirth
        motherDateBirth
        senif
        bankNum
        accountNum
        fullName { firstName lastName }
        phone { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode additionalPhones }
        dadPhone { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode additionalPhones }
        momPhone { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode additionalPhones }
        email { primaryEmail additionalEmails }
        fatherEmail { primaryEmail additionalEmails }
        motherEmail { primaryEmail additionalEmails }
        adders {
          addressStreet1
          addressStreet2
          addressCity
          addressPostcode
          addressState
          addressCountry
          addressLat
          addressLng
        }
      }
    }
  }
}
`;

const ALL_STUDENTS_QUERY = `
query AllStudents($first: Int!, $after: String) {
  students(first: $first, after: $after) {
    edges {
      node {
        id
        name
        tznum
        tzMotherNum
        tzaba
        class
        dateofbirth
        currentInstitution
        registration
        macAddress
        note
        famliystatus
        healthInsurance
        shmHb
        shmHm
        fatherDatebirth
        motherDateBirth
        senif
        bankNum
        accountNum
        fullName { firstName lastName }
        phone { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode additionalPhones }
        dadPhone { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode additionalPhones }
        momPhone { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode additionalPhones }
        email { primaryEmail additionalEmails }
        fatherEmail { primaryEmail additionalEmails }
        motherEmail { primaryEmail additionalEmails }
        adders {
          addressStreet1
          addressStreet2
          addressCity
          addressPostcode
          addressState
          addressCountry
          addressLat
          addressLng
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
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
    macAddress
    note
    famliystatus
    healthInsurance
    shmHb
    shmHm
    tzMotherNum
    tzaba
    fatherDatebirth
    motherDateBirth
    senif
    bankNum
    accountNum
    fullName { firstName lastName }
    phone { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode additionalPhones }
    dadPhone { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode additionalPhones }
    momPhone { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode additionalPhones }
    email { primaryEmail additionalEmails }
    fatherEmail { primaryEmail additionalEmails }
    motherEmail { primaryEmail additionalEmails }
    adders {
      addressStreet1
      addressStreet2
      addressCity
      addressPostcode
      addressState
      addressCountry
      addressLat
      addressLng
    }
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

const CREATE_STUDENT_MUTATION = `
mutation CreateStudent($data: StudentCreateInput!) {
  createStudent(data: $data) {
    id
  }
}
`;

const UPDATE_STUDENT_MUTATION = `
mutation UpdateStudent($id: UUID!, $data: StudentUpdateInput!) {
  updateStudent(id: $id, data: $data) {
    id
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
  const label = directLabel || `${first} ${last}`.trim() || String(node?.name || "").trim() || "ללא שם";
  return {
    id: node.id || node.recordId,
    objectName: node.objectNameSingular || "student",
    label,
    fullName: node?.fullName || null,
    tznum: node?.tznum || "",
    tzMotherNum: node?.tzMotherNum || "",
    tzaba: node?.tzaba || "",
    class: node?.class || "",
    dateofbirth: node?.dateofbirth || "",
    currentInstitution: node?.currentInstitution || "",
    registration: node?.registration || "",
    macAddress: node?.macAddress || "",
    note: node?.note || "",
    famliystatus: node?.famliystatus || "",
    healthInsurance: node?.healthInsurance || "",
    shmHb: node?.shmHb || "",
    shmHm: node?.shmHm || "",
    fatherDatebirth: node?.fatherDatebirth || "",
    motherDateBirth: node?.motherDateBirth || "",
    senif: node?.senif || "",
    bankNum: node?.bankNum || "",
    accountNum: node?.accountNum || "",
    phone: node?.phone || null,
    dadPhone: node?.dadPhone || null,
    momPhone: node?.momPhone || null,
    email: node?.email || null,
    fatherEmail: node?.fatherEmail || null,
    motherEmail: node?.motherEmail || null,
    adders: node?.adders || null
  };
}

export async function searchStudentsByText(q, maxResults = 10) {
  if (!q) return [];
  const safeLimit = Math.max(1, Math.min(Number(maxResults) || 10, 10));
  const data = await gql(SEARCH_QUERY, {
    searchInput: q,
    limit: safeLimit,
    excludedObjectNameSingulars: ["workspaceMember"],
    includedObjectNameSingulars: ["student"]
  });
  const edges = data?.search?.edges || [];
  const ids = edges
    .map((e) => e?.node?.recordId)
    .filter(Boolean)
    .slice(0, safeLimit);

  const fullStudents = await Promise.all(
    ids.map(async (id) => {
      try {
        return await getStudentById(id);
      } catch {
        return null;
      }
    })
  );

  return fullStudents.filter(Boolean).map((node) => mapNode(node));
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

export async function listAllStudents(limitPerPage = 200, maxPages = 10) {
  const out = [];
  let after = null;
  let hasNextPage = true;
  let page = 0;

  while (hasNextPage && page < maxPages) {
    const data = await gql(ALL_STUDENTS_QUERY, {
      first: limitPerPage,
      after
    });
    const connection = data?.students;
    const edges = connection?.edges || [];
    out.push(...edges.map((e) => mapNode(e.node)));

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
    page += 1;
    if (!hasNextPage || !after) break;
  }

  return out;
}
export async function getStudentById(id) {
  const data = await gql(STUDENT_BY_ID_QUERY, { id });
  return data?.student || null;
}

export async function createStudentByData(data) {
  const result = await gql(CREATE_STUDENT_MUTATION, { data });
  return result?.createStudent || null;
}

export async function updateStudentById(id, data) {
  const result = await gql(UPDATE_STUDENT_MUTATION, { id, data });
  return result?.updateStudent || null;
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



















