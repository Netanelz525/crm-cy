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

const DELETE_STUDENT_MUTATION = `
mutation DeleteStudent($id: UUID!) {
  deleteStudent(id: $id) {
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

  if (!res.ok) {
    throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`);
  }

  const payload = await res.json();
  if (payload.errors?.length) {
    const message = payload.errors.map((item) => item.message).join(" | ");
    throw new Error(message || "Unknown GraphQL error");
  }

  return payload.data;
}

function clean(value) {
  return String(value || "").trim();
}

function buildStudentLabel(node) {
  const firstName = clean(node?.fullName?.firstName);
  const lastName = clean(node?.fullName?.lastName);
  const fullNameLabel = [firstName, lastName].filter(Boolean).join(" ");
  if (fullNameLabel) return fullNameLabel;

  const rawName = clean(node?.name || node?.label);
  const normalizedRawName = rawName.toLowerCase();
  const isBrokenName = !rawName || normalizedRawName === "untitled" || /undefined|null/i.test(rawName);
  if (!isBrokenName) return rawName;

  const tznum = clean(node?.tznum);
  return tznum ? `ללא שם (${tznum})` : "ללא שם";
}

function mapNode(node) {
  if (!node) return null;
  const label = buildStudentLabel(node);
  return {
    ...node,
    id: node.id,
    label,
    name: label
  };
}

export async function searchStudentsByText(q, maxResults = 10) {
  const searchInput = clean(q);
  if (!searchInput) return [];

  const data = await gql(SEARCH_QUERY, {
    searchInput,
    limit: maxResults,
    excludedObjectNameSingulars: ["workspaceMember"],
    includedObjectNameSingulars: ["student"]
  });

  const ids = (data?.search?.edges || [])
    .map((edge) => edge?.node)
    .filter((node) => node?.objectNameSingular === "student")
    .map((node) => node.recordId)
    .filter(Boolean)
    .slice(0, maxResults);

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

export async function deleteStudentById(id) {
  const result = await gql(DELETE_STUDENT_MUTATION, { id });
  return result?.deleteStudent || null;
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

