const TEACHER_HEADERS = [
  "teacherId",
  "nip",
  "nuptk",
  "name",
  "position",
  "status",
  "subject",
  "qrCodeId",
  "nik",
  "gender",
  "birthPlace",
  "birthDate",
  "village",
  "district",
  "regency",
  "phone",
  "email",
  "education",
  "major",
  "graduationYear",
  "teachingHours"
];

function ensureTeacherHeaders(sheet) {
  const lastCol = sheet.getLastColumn();
  let headers = [];
  if (lastCol > 0) {
    headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); });
  }

  let needsUpdate = false;
  if (headers.length < TEACHER_HEADERS.length) {
    needsUpdate = true;
  } else {
    for (let i = 0; i < TEACHER_HEADERS.length; i++) {
      if (headers[i] !== TEACHER_HEADERS[i]) {
        needsUpdate = true;
        break;
      }
    }
  }

  if (needsUpdate) {
    sheet.getRange(1, 1, 1, TEACHER_HEADERS.length).setValues([TEACHER_HEADERS]);
  }
}

function validateTeacherGender(gender) {
  const normalized = normalizeString(gender);
  if (!normalized) {
    return {
      success: true,
      value: ""
    };
  }

  if (normalized === "L" || normalized === "P") {
    return {
      success: true,
      value: normalized
    };
  }

  const lower = normalized.toLowerCase();
  if (lower === "laki-laki" || lower === "laki - laki" || lower === "pria") {
    return {
      success: true,
      value: "L"
    };
  }

  if (lower === "perempuan" || lower === "wanita") {
    return {
      success: true,
      value: "P"
    };
  }

  return {
    success: false,
    message: "Jenis Kelamin harus L atau P jika diisi."
  };
}

function getTeachersSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_TEACHERS);

  if (!sheet) {
    return {
      success: false,
      message: "Sheet Teachers tidak ditemukan."
    };
  }

  return {
    success: true,
    sheet: sheet
  };
}



function buildTeacherObject(headers, row) {
  const teacher = {};

  TEACHER_HEADERS.forEach(function(header) {
    const index = headers.indexOf(header);
    teacher[header] = index !== -1 ? normalizeString(row[index]) : "";
  });

  return teacher;
}

function findTeacherRowById(sheet, teacherId) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const idIndex = headerMap["teacherId"];

  if (idIndex === undefined || idIndex === -1) {
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedId = normalizeString(teacherId);

  for (let i = 0; i < values.length; i++) {
    if (normalizeString(values[i][idIndex]) === normalizedId) {
      return {
        rowIndex: i + 2,
        rowValues: values[i],
        headers: headers,
        headerMap: headerMap
      };
    }
  }

  return null;
}

function isTeacherIdExists(sheet, teacherId) {
  return !!findTeacherRowById(sheet, teacherId);
}

function validateTeacherStatus(status) {
  const normalized = normalizeString(status) || "Active";
  if (normalized !== "Active" && normalized !== "Inactive") {
    return {
      success: false,
      message: "Status harus Active atau Inactive."
    };
  }
  return {
    success: true,
    value: normalized
  };
}

function getTeachers() {
  const sheetResult = getTeachersSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  ensureTeacherHeaders(sheet);
  const headers = getSheetHeaders(sheet);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return {
      success: true,
      teachers: []
    };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const teachers = rows.map(function(row) {
    return buildTeacherObject(headers, row);
  });

  return {
    success: true,
    teachers: teachers
  };
}

function getTeacherById(teacherId) {
  const sheetResult = getTeachersSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(teacherId)) {
    return {
      success: false,
      message: "teacherId tidak boleh kosong."
    };
  }

  const sheet = sheetResult.sheet;
  ensureTeacherHeaders(sheet);
  const teacherRow = findTeacherRowById(sheet, teacherId);
  if (!teacherRow) {
    return {
      success: false,
      message: "Data guru tidak ditemukan."
    };
  }

  return {
    success: true,
    teacher: buildTeacherObject(teacherRow.headers, teacherRow.rowValues)
  };
}

function createTeacher(token, data) {
  const auth = validateAdminSession(token);
  if (!auth || !auth.valid) {
    return {
      success: false,
      message: auth ? auth.message : "Akses ditolak: Hanya Admin yang memiliki izin untuk operasi ini."
    };
  }

  const sheetResult = getTeachersSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  ensureTeacherHeaders(sheet);

  const name = normalizeString(data.name);
  if (!name) {
    return {
      success: false,
      message: "name wajib diisi."
    };
  }

  const statusValidation = validateTeacherStatus(data.status);
  if (!statusValidation.success) {
    return statusValidation;
  }

  const nip = normalizeString(data.nip);
  const nuptk = normalizeString(data.nuptk);
  const position = normalizeString(data.position);
  const subject = normalizeString(data.subject);

  // New fields (Bug 15)
  const nik = normalizeString(data.nik);
  const genderValidation = validateTeacherGender(data.gender);
  if (!genderValidation.success) {
    return genderValidation;
  }
  const gender = genderValidation.value;
  const birthPlace = normalizeString(data.birthPlace);
  const birthDate = normalizeString(data.birthDate);
  const village = normalizeString(data.village);
  const district = normalizeString(data.district);
  const regency = normalizeString(data.regency);
  const phone = normalizeString(data.phone);
  const email = normalizeString(data.email);
  const education = normalizeString(data.education);
  const major = normalizeString(data.major);
  const graduationYear = normalizeString(data.graduationYear);
  const teachingHours = normalizeString(data.teachingHours);

  const lock = LockService.getScriptLock();
  const lockAcquired = lock.tryLock(5000);
  if (!lockAcquired) {
    return {
      success: false,
      message: "Server sedang sibuk memproses penambahan guru. Silakan coba lagi."
    };
  }

  try {
    const identityResult = generateTeacherId(sheet);
    if (!identityResult.success) {
      return identityResult;
    }

    const teacherId = identityResult.teacherId;

    if (isTeacherIdExists(sheet, teacherId)) {
      return {
        success: false,
        message: "teacherId sudah digunakan."
      };
    }

    const row = [
      teacherId,
      nip,
      nuptk,
      name,
      position,
      statusValidation.value,
      subject,
      "", // qrCodeId
      nik,
      gender,
      birthPlace,
      birthDate,
      village,
      district,
      regency,
      phone,
      email,
      education,
      major,
      graduationYear,
      teachingHours
    ];

    sheet.appendRow(row);

    return {
      success: true,
      message: "Data guru berhasil ditambahkan.",
      teacher: {
        teacherId: teacherId,
        nip: nip,
        nuptk: nuptk,
        name: name,
        position: position,
        status: statusValidation.value,
        subject: subject,
        qrCodeId: "",
        nik: nik,
        gender: gender,
        birthPlace: birthPlace,
        birthDate: birthDate,
        village: village,
        district: district,
        regency: regency,
        phone: phone,
        email: email,
        education: education,
        major: major,
        graduationYear: graduationYear,
        teachingHours: teachingHours
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function updateTeacher(token, data) {
  const auth = validateAdminSession(token);
  if (!auth || !auth.valid) {
    return {
      success: false,
      message: auth ? auth.message : "Akses ditolak: Hanya Admin yang memiliki izin untuk operasi ini."
    };
  }

  const sheetResult = getTeachersSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const teacherId = normalizeString(data.teacherId);
  if (!teacherId) {
    return {
      success: false,
      message: "teacherId tidak boleh kosong."
    };
  }

  const sheet = sheetResult.sheet;
  ensureTeacherHeaders(sheet);
  const teacherRow = findTeacherRowById(sheet, teacherId);

  if (!teacherRow) {
    return {
      success: false,
      message: "Data guru tidak ditemukan."
    };
  }

  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const rawValues = teacherRow.rowValues;
  const rowValues = [];

  // Pad or copy values to ensure all headers length
  for (let i = 0; i < headers.length; i++) {
    rowValues.push(i < rawValues.length ? rawValues[i] : "");
  }

  const name = data.name !== undefined ? normalizeString(data.name) : normalizeString(rowValues[headerMap["name"]]);
  if (!name) {
    return {
      success: false,
      message: "name wajib diisi."
    };
  }

  const statusValue = data.status !== undefined ? data.status : rowValues[headerMap["status"]];
  const statusValidation = validateTeacherStatus(statusValue);
  if (!statusValidation.success) {
    return statusValidation;
  }

  if (headerMap["name"] !== undefined) rowValues[headerMap["name"]] = name;
  if (headerMap["status"] !== undefined) rowValues[headerMap["status"]] = statusValidation.value;
  if (headerMap["nip"] !== undefined && data.nip !== undefined) rowValues[headerMap["nip"]] = normalizeString(data.nip);
  if (headerMap["nuptk"] !== undefined && data.nuptk !== undefined) rowValues[headerMap["nuptk"]] = normalizeString(data.nuptk);
  if (headerMap["position"] !== undefined && data.position !== undefined) rowValues[headerMap["position"]] = normalizeString(data.position);
  if (headerMap["subject"] !== undefined && data.subject !== undefined) rowValues[headerMap["subject"]] = normalizeString(data.subject);

  // New fields (Bug 15)
  if (data.gender !== undefined) {
    const genderVal = validateTeacherGender(data.gender);
    if (!genderVal.success) return genderVal;
    if (headerMap["gender"] !== undefined) rowValues[headerMap["gender"]] = genderVal.value;
  }
  if (headerMap["nik"] !== undefined && data.nik !== undefined) rowValues[headerMap["nik"]] = normalizeString(data.nik);
  if (headerMap["birthPlace"] !== undefined && data.birthPlace !== undefined) rowValues[headerMap["birthPlace"]] = normalizeString(data.birthPlace);
  if (headerMap["birthDate"] !== undefined && data.birthDate !== undefined) rowValues[headerMap["birthDate"]] = normalizeString(data.birthDate);
  if (headerMap["village"] !== undefined && data.village !== undefined) rowValues[headerMap["village"]] = normalizeString(data.village);
  if (headerMap["district"] !== undefined && data.district !== undefined) rowValues[headerMap["district"]] = normalizeString(data.district);
  if (headerMap["regency"] !== undefined && data.regency !== undefined) rowValues[headerMap["regency"]] = normalizeString(data.regency);
  if (headerMap["phone"] !== undefined && data.phone !== undefined) rowValues[headerMap["phone"]] = normalizeString(data.phone);
  if (headerMap["email"] !== undefined && data.email !== undefined) rowValues[headerMap["email"]] = normalizeString(data.email);
  if (headerMap["education"] !== undefined && data.education !== undefined) rowValues[headerMap["education"]] = normalizeString(data.education);
  if (headerMap["major"] !== undefined && data.major !== undefined) rowValues[headerMap["major"]] = normalizeString(data.major);
  if (headerMap["graduationYear"] !== undefined && data.graduationYear !== undefined) rowValues[headerMap["graduationYear"]] = normalizeString(data.graduationYear);
  if (headerMap["teachingHours"] !== undefined && data.teachingHours !== undefined) rowValues[headerMap["teachingHours"]] = normalizeString(data.teachingHours);

  sheet.getRange(teacherRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Data guru berhasil diperbarui.",
    teacher: buildTeacherObject(headers, rowValues)
  };
}

function setTeacherStatus(token, teacherId, status) {
  const auth = validateAdminSession(token);
  if (!auth || !auth.valid) {
    return {
      success: false,
      message: auth ? auth.message : "Akses ditolak: Hanya Admin yang memiliki izin untuk operasi ini."
    };
  }

  const sheetResult = getTeachersSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(teacherId)) {
    return {
      success: false,
      message: "teacherId tidak boleh kosong."
    };
  }

  if (status === undefined || status === null || normalizeString(status) === "") {
    return {
      success: false,
      message: "status wajib diisi dan harus Active atau Inactive."
    };
  }

  const statusValidation = validateTeacherStatus(status);
  if (!statusValidation.success) {
    return statusValidation;
  }

  const teacherRow = findTeacherRowById(sheetResult.sheet, teacherId);
  if (!teacherRow) {
    return {
      success: false,
      message: "Data guru tidak ditemukan."
    };
  }

  const rowValues = teacherRow.rowValues.slice();
  rowValues[teacherRow.headerMap["status"]] = statusValidation.value;

  sheetResult.sheet.getRange(teacherRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Status guru berhasil diperbarui.",
    teacher: buildTeacherObject(teacherRow.headers, rowValues)
  };
}

const MASTER_19_TEACHERS_DATA = [
  {
    teacherId: "TCH-0001",
    name: "MOCH. IQNAUL BADRIL FALAH, S.Ag",
    nik: "3317050807930001",
    gender: "",
    birthPlace: "Rembang",
    birthDate: "1993-07-08",
    village: "Temperak",
    district: "Sarang",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "S1",
    major: "Agama",
    graduationYear: "",
    teachingHours: "17"
  },
  {
    teacherId: "TCH-0002",
    name: "MUHAMMAD KHOZINUL ASROR",
    nik: "3674030505080013",
    gender: "",
    birthPlace: "Tangerang Selatan",
    birthDate: "2008-05-05",
    village: "Pondok Pucung",
    district: "Pondok Aren",
    regency: "Tangerang Selatan",
    phone: "",
    email: "",
    education: "MA",
    major: "Agama",
    graduationYear: "",
    teachingHours: "4"
  },
  {
    teacherId: "TCH-0003",
    name: "UMI ASROH, S.Pd",
    nik: "3317055402910001",
    gender: "",
    birthPlace: "Rembang",
    birthDate: "1991-02-14",
    village: "Sampung",
    district: "Sarang",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "S1",
    major: "Pend. Biologi",
    graduationYear: "",
    teachingHours: "6"
  },
  {
    teacherId: "TCH-0004",
    name: "MUHAMMAD ALI MURTADLO",
    nik: "3302232901020001",
    gender: "",
    birthPlace: "Banyumas",
    birthDate: "2002-01-29",
    village: "Kedungbanteng",
    district: "Kedungbanteng",
    regency: "Banyumas",
    phone: "",
    email: "",
    education: "S1",
    major: "Agama",
    graduationYear: "",
    teachingHours: "6"
  },
  {
    teacherId: "TCH-0005",
    name: "MUHAMMAD MA'RUF AMIN",
    nik: "3302181306990001",
    gender: "",
    birthPlace: "Banyumas",
    birthDate: "1999-06-13",
    village: "Pasir Kulon",
    district: "Karanglewas",
    regency: "Banyumas",
    phone: "",
    email: "",
    education: "S1",
    major: "Agama",
    graduationYear: "",
    teachingHours: "6"
  },
  {
    teacherId: "TCH-0006",
    name: "SITI DUROTUL BAIDHO, S.Pd",
    nik: "3317056802010001",
    gender: "",
    birthPlace: "Rembang",
    birthDate: "2001-02-28",
    village: "Bajingjowo",
    district: "Sarang",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "MAN",
    major: "IPS",
    graduationYear: "",
    teachingHours: "12"
  },
  {
    teacherId: "TCH-0007",
    name: "MUHAMMAD LUTFI, S.Ag",
    nik: "3317060911980001",
    gender: "",
    birthPlace: "Rembang",
    birthDate: "1998-11-09",
    village: "Menoro",
    district: "Sedan",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "S1",
    major: "Agama",
    graduationYear: "",
    teachingHours: "12"
  },
  {
    teacherId: "TCH-0008",
    name: "NAILATUL HIDAYAH",
    nik: "3317056310020002",
    gender: "",
    birthPlace: "Rembang",
    birthDate: "2001-10-20",
    village: "Temperak",
    district: "Sarang",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "MA",
    major: "Agama",
    graduationYear: "",
    teachingHours: "6"
  },
  {
    teacherId: "TCH-0009",
    name: "FARIDATUN NI'MAH, S.Pd",
    nik: "3317055010900004",
    gender: "",
    birthPlace: "Rembang",
    birthDate: "1990-10-10",
    village: "Sendangmulyo",
    district: "Sarang",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "S1",
    major: "Pend. Matematika",
    graduationYear: "",
    teachingHours: "12"
  },
  {
    teacherId: "TCH-0010",
    name: "YUYUN YULIANINGSIH, S.Sos",
    nik: "3318057108950001",
    gender: "",
    birthPlace: "Pati",
    birthDate: "1995-08-31",
    village: "Pelang",
    district: "Sarang",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "S1",
    major: "BKI",
    graduationYear: "",
    teachingHours: "8"
  },
  {
    teacherId: "TCH-0011",
    name: "A. MUAFAQ, S.Pd",
    nik: "3317050110960008",
    gender: "",
    birthPlace: "Rembang",
    birthDate: "1996-10-01",
    village: "Temperak",
    district: "Sarang",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "S1",
    major: "Pend. Biologi",
    graduationYear: "",
    teachingHours: "8"
  },
  {
    teacherId: "TCH-0012",
    name: "WASIUL ULA, S.Ag",
    nik: "3317120202970001",
    gender: "",
    birthPlace: "Rembang",
    birthDate: "",
    village: "Karang Harjo",
    district: "Kragan",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "S1",
    major: "Agama",
    graduationYear: "",
    teachingHours: "6"
  },
  {
    teacherId: "TCH-0013",
    name: "ZUHAD AWWAB SYAHBANA",
    nik: "3308202809060004",
    gender: "",
    birthPlace: "Magelang",
    birthDate: "2006-09-28",
    village: "Jetis",
    district: "Secang",
    regency: "Magelang",
    phone: "",
    email: "",
    education: "MA",
    major: "Agama",
    graduationYear: "",
    teachingHours: "4"
  },
  {
    teacherId: "TCH-0014",
    name: "BELLATUL FAUZIYAH, S.Pd",
    nik: "3317054304010010",
    gender: "",
    birthPlace: "Rembang",
    birthDate: "2001-04-03",
    village: "Karangmangu",
    district: "Sarang",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "S1",
    major: "PAI",
    graduationYear: "",
    teachingHours: "8"
  },
  {
    teacherId: "TCH-0015",
    name: "TSURRAYYA ROCHMANIA, S.E",
    nik: "3317056110970001",
    gender: "",
    birthPlace: "Rembang",
    birthDate: "1997-10-21",
    village: "Bonjor",
    district: "Sarang",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "S1",
    major: "Perbankan Syariah",
    graduationYear: "",
    teachingHours: "16"
  },
  {
    teacherId: "TCH-0016",
    name: "MOCH. SOHIBUL MAHBUB, S.Ag",
    nik: "3317050110970003",
    gender: "",
    birthPlace: "Rembang",
    birthDate: "1997-10-01",
    village: "Sarangmeduro",
    district: "Sarang",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "S1",
    major: "Agama",
    graduationYear: "",
    teachingHours: "12"
  },
  {
    teacherId: "TCH-0017",
    name: "SAMSUL",
    nik: "3317120610970004",
    gender: "",
    birthPlace: "Rembang",
    birthDate: "1997-10-06",
    village: "Sumurtawang",
    district: "Kragan",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "S1",
    major: "Agama",
    graduationYear: "",
    teachingHours: "6"
  },
  {
    teacherId: "TCH-0018",
    name: "MOCH. SHOFIYUL ALBAB, S.H",
    nik: "3317052701980001",
    gender: "",
    birthPlace: "Rembang",
    birthDate: "1998-01-27",
    village: "Bajingjowo",
    district: "Sarang",
    regency: "Rembang",
    phone: "",
    email: "",
    education: "S1",
    major: "Hukum Keluarga",
    graduationYear: "",
    teachingHours: "6"
  },
  {
    teacherId: "TCH-0019",
    name: "NAQIYUHSADIQIN",
    nik: "3526152606050002",
    gender: "",
    birthPlace: "Bangkalan",
    birthDate: "2005-06-26",
    village: "Blega Oloh",
    district: "Blega",
    regency: "Bangkalan",
    phone: "",
    email: "",
    education: "MA",
    major: "Agama",
    graduationYear: "",
    teachingHours: "4"
  }
];

function migrateTeacherSchemaAndData() {
  const sheetResult = getTeachersSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  ensureTeacherHeaders(sheet);

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return {
      success: true,
      message: "Tidak ada baris data guru untuk dimigrasi.",
      updated: 0
    };
  }

  const currentValues = sheet.getRange(2, 1, lastRow - 1, TEACHER_HEADERS.length).getValues();
  let updatedCount = 0;

  const masterMapById = {};
  const masterMapByName = {};
  MASTER_19_TEACHERS_DATA.forEach(function(m) {
    masterMapById[m.teacherId] = m;
    masterMapByName[m.name.trim().toLowerCase()] = m;
  });

  for (let i = 0; i < currentValues.length; i++) {
    const row = currentValues[i];
    const teacherId = normalizeString(row[0]);
    const name = normalizeString(row[3]).toLowerCase();

    const master = masterMapById[teacherId] || masterMapByName[name];
    if (master) {
      // Columns 8 to 20: nik, gender, birthPlace, birthDate, village, district, regency, phone, email, education, major, graduationYear, teachingHours
      if (!normalizeString(row[8])) row[8] = master.nik || "";
      if (!normalizeString(row[9]) && master.gender) row[9] = master.gender;
      if (!normalizeString(row[10])) row[10] = master.birthPlace || "";
      if (!normalizeString(row[11])) row[11] = master.birthDate || "";
      if (!normalizeString(row[12])) row[12] = master.village || "";
      if (!normalizeString(row[13])) row[13] = master.district || "";
      if (!normalizeString(row[14])) row[14] = master.regency || "";
      if (!normalizeString(row[15])) row[15] = master.phone || "";
      if (!normalizeString(row[16])) row[16] = master.email || "";
      if (!normalizeString(row[17])) row[17] = master.education || "";
      if (!normalizeString(row[18])) row[18] = master.major || "";
      if (!normalizeString(row[19])) row[19] = master.graduationYear || "";
      if (!normalizeString(row[20])) row[20] = master.teachingHours || "";
      updatedCount++;
    }
  }

  sheet.getRange(2, 1, currentValues.length, TEACHER_HEADERS.length).setValues(currentValues);

  return {
    success: true,
    message: "Migrasi schema dan data guru selesai.",
    totalRows: currentValues.length,
    updated: updatedCount
  };
}
