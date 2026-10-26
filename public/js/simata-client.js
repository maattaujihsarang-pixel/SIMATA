/**
 * SIMATA Client REST Library (Modern REST Client for SIMATA)
 * Replaces legacy GAS google.script.run with direct Node.js Express REST API integration.
 * 
 * Supports both:
 * 1. Callback chaining: simataClient.withSuccessHandler(cb).withFailureHandler(errCb).method(...args)
 * 2. Modern Promises: await simataClient.method(...args)
 * 
 * Verified Inventory:
 * - 41 unique client functions
 * - Dual sessionStorage token support (SIMATA_TOKEN and simata_token)
 * - Base64 DataURL and Multipart Blob photo conversion for teacher attendance (F-P5-005)
 * - Complete normalization of camelCase <-> snake_case domain entities
 */
(function (window) {
  'use strict';

  const API_BASE = '/api/v1';

  function getStoredToken() {
    try {
      return (
        window.sessionStorage.getItem('SIMATA_TOKEN') ||
        window.sessionStorage.getItem('simata_token') ||
        null
      );
    } catch (_) {
      return null;
    }
  }

  function setStoredToken(token) {
    try {
      if (token) {
        window.sessionStorage.setItem('SIMATA_TOKEN', token);
        window.sessionStorage.setItem('simata_token', token);
      } else {
        window.sessionStorage.removeItem('SIMATA_TOKEN');
        window.sessionStorage.removeItem('simata_token');
      }
    } catch (_) {}
  }

  function dataURLtoBlob(dataurl) {
    try {
      if (!dataurl || typeof dataurl !== 'string') return null;
      const parts = dataurl.split(',');
      if (parts.length < 2) return null;
      const mimeMatch = parts[0].match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    } catch (e) {
      console.error('[SIMATA Client] dataURLtoBlob error:', e);
      return null;
    }
  }

  function normalizeCalendarDate(val) {
    if (!val) return '';
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        return trimmed.substring(0, 10);
      }
      return trimmed;
    }
    if (val instanceof Date && !isNaN(val.getTime())) {
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const d = String(val.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return String(val);
  }

  async function apiFetch(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = options.headers || {};
    const token = getStoredToken();

    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchConfig = {
      method: options.method || 'GET',
      headers,
      body: options.body
    };

    const response = await window.fetch(url, fetchConfig);
    const result = await response.json().catch(() => ({
      status: 'error',
      message: 'Respon server bukan format JSON yang valid'
    }));

    if (!response.ok) {
      const err = new Error(result.message || `HTTP Error ${response.status}`);
      err.status = response.status;
      err.code = result.code;
      err.details = result.details;
      throw err;
    }

    return result;
  }

  // Define client function implementations
  const functionDefinitions = {
    // 1. Auth: checkLogin
    checkLogin: async function (username, password) {
      try {
        const res = await apiFetch('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });
        if (res.data && res.data.token) {
          setStoredToken(res.data.token);
        }
        return {
          success: true,
          token: res.data.token,
          role: res.data.user.role,
          nama: res.data.user.full_name || res.data.user.username,
          user: res.data.user
        };
      } catch (err) {
        if (err.status === 401 || err.status === 400) {
          return {
            success: false,
            message: err.message || 'Username atau Password salah.'
          };
        }
        throw err;
      }
    },

    // 2. Auth: logout
    logout: async function (token) {
      try {
        await apiFetch('/auth/logout', { method: 'POST' });
      } catch (_) {
        // Continue clearing client token even if backend request fails
      } finally {
        setStoredToken(null);
      }
      return { success: true, message: 'Logout berhasil' };
    },

    // 3. Auth: validateSession
    validateSession: async function (token) {
      try {
        const res = await apiFetch('/auth/me');
        const user = res.data.user;
        return {
          valid: true,
          user: user,
          role: user.role,
          username: user.username,
          nama: user.full_name || user.username
        };
      } catch (e) {
        return { valid: false, error: e.message };
      }
    },

    // 4. Users: getAccounts
    getAccounts: async function (token) {
      let currentUsername = '';
      try {
        const meRes = await apiFetch('/auth/me');
        currentUsername = meRes.data.user.username;
      } catch (_) {}

      const res = await apiFetch('/users');
      const accounts = (res.data || []).map((u) => ({
        username: u.username,
        role: u.role,
        name: u.full_name || u.username,
        fullName: u.full_name || u.username,
        createdAt: u.created_at
      }));
      return {
        success: true,
        accounts: accounts,
        currentUsername: currentUsername
      };
    },

    // 5. Users: createAccount
    createAccount: async function (...args) {
      const data = args.find((a) => a && typeof a === 'object') || {};
      const body = {
        username: data.username,
        password: data.password,
        full_name: data.name || data.fullName || data.full_name,
        role: data.role
      };
      const res = await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      return { success: true, message: res.message, user: res.data };
    },

    // 6. Users: updateAccount
    updateAccount: async function (...args) {
      const data = args.find((a) => a && typeof a === 'object') || {};
      const id = data.originalUsername || data.username || data.user_id || data.id;
      const body = {
        username: data.username,
        full_name: data.name || data.fullName || data.full_name,
        role: data.role
      };
      if (data.password) {
        body.password = data.password;
      }
      const res = await apiFetch(`/users/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body)
      });
      return { success: true, message: res.message, user: res.data };
    },

    // 7. Users: deleteAccount
    deleteAccount: async function (...args) {
      const targetId = args.length === 1 ? args[0] : args[args.length - 1];
      const res = await apiFetch(`/users/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
      return { success: true, message: res.message };
    },

    // 8. Teachers: getTeachers
    getTeachers: async function (statusOrFilter) {
      let q = '';
      if (typeof statusOrFilter === 'string') {
        q = `?status=${encodeURIComponent(statusOrFilter)}`;
      } else if (typeof statusOrFilter === 'object' && statusOrFilter !== null) {
        const params = new URLSearchParams(statusOrFilter).toString();
        if (params) q = `?${params}`;
      }
      const res = await apiFetch(`/teachers${q}`);
      const teachers = (res.data || []).map((t) => ({
        teacherId: t.teacher_id,
        name: t.full_name,
        fullName: t.full_name,
        nip: t.nip,
        gender: t.gender,
        subjectSpecialty: t.subject_specialty,
        phone: t.phone,
        status: t.status,
        ...t
      }));
      return { success: true, teachers: teachers };
    },

    // 9. Teachers: getTeacherById
    getTeacherById: async function (teacherId) {
      const res = await apiFetch(`/teachers/${encodeURIComponent(teacherId)}`);
      const t = res.data;
      const teacherObj = {
        teacherId: t.teacher_id,
        name: t.full_name,
        fullName: t.full_name,
        nip: t.nip,
        gender: t.gender,
        subjectSpecialty: t.subject_specialty,
        phone: t.phone,
        status: t.status,
        ...t
      };
      return { success: true, teacher: teacherObj };
    },

    // 10. Teachers: createTeacher
    createTeacher: async function (...args) {
      const data = args.find((a) => a && typeof a === 'object') || {};
      const payload = {
        teacher_id: data.teacherId || data.teacher_id,
        name: data.name || data.fullName || data.full_name,
        full_name: data.name || data.fullName || data.full_name,
        subject: data.subject || data.subjectSpecialty || data.subject_specialty,
        subject_specialty: data.subject || data.subjectSpecialty || data.subject_specialty,
        nip: data.nip || null,
        gender: data.gender || null,
        phone: data.phone || null,
        status: data.status || 'Active'
      };
      const res = await apiFetch('/teachers', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return { success: true, message: res.message, teacher: res.data };
    },

    // 11. Teachers: updateTeacher
    updateTeacher: async function (...args) {
      const data = args.find((a) => a && typeof a === 'object') || {};
      const id = data.teacherId || data.teacher_id || data.id;
      const payload = {
        name: data.name || data.fullName || data.full_name,
        full_name: data.name || data.fullName || data.full_name,
        subject: data.subject || data.subjectSpecialty || data.subject_specialty,
        subject_specialty: data.subject || data.subjectSpecialty || data.subject_specialty,
        nip: data.nip || null,
        gender: data.gender || null,
        phone: data.phone || null,
        status: data.status || 'Active'
      };
      const res = await apiFetch(`/teachers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return { success: true, message: res.message, teacher: res.data };
    },

    // 12. Teachers: setTeacherStatus
    setTeacherStatus: async function (teacherId, status) {
      const res = await apiFetch(`/teachers/${encodeURIComponent(teacherId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      return { success: true, message: res.message, teacher: res.data };
    },

    // 13. Classes: getClasses
    getClasses: async function (statusOrFilter) {
      let q = '';
      if (typeof statusOrFilter === 'string') {
        q = `?status=${encodeURIComponent(statusOrFilter)}`;
      } else if (typeof statusOrFilter === 'object' && statusOrFilter !== null) {
        const params = new URLSearchParams(statusOrFilter).toString();
        if (params) q = `?${params}`;
      }
      const res = await apiFetch(`/classes${q}`);
      const classes = (res.data || []).map((c) => ({
        classId: c.class_id,
        className: c.class_name,
        level: c.level,
        academicYear: c.academic_year_id,
        homeroomTeacherId: c.homeroom_teacher_id,
        status: c.status,
        ...c
      }));
      return { success: true, classes: classes };
    },

    // 14. Classes: getClassById
    getClassById: async function (classId) {
      const res = await apiFetch(`/classes/${encodeURIComponent(classId)}`);
      const c = res.data;
      const classObj = {
        classId: c.class_id,
        className: c.class_name,
        level: c.level,
        academicYear: c.academic_year_id,
        homeroomTeacherId: c.homeroom_teacher_id,
        status: c.status,
        ...c
      };
      return { success: true, class: classObj, classObj: classObj };
    },

    // 15. Classes: createClass
    createClass: async function (...args) {
      const data = args.find((a) => a && typeof a === 'object') || {};
      const payload = {
        class_id: data.classId || data.class_id,
        class_name: data.className || data.class_name,
        level: data.level ? String(data.level) : '10',
        academic_year_id: data.academicYear || data.academic_year_id || '2026/2027',
        homeroom_teacher_id: data.homeroomTeacherId || data.homeroom_teacher_id || null,
        status: data.status || 'Active'
      };
      const res = await apiFetch('/classes', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return { success: true, message: res.message, class: res.data };
    },

    // 16. Classes: updateClass
    updateClass: async function (...args) {
      const data = args.find((a) => a && typeof a === 'object') || {};
      const id = data.classId || data.class_id || data.id;
      const payload = {
        class_name: data.className || data.class_name,
        level: data.level ? String(data.level) : undefined,
        academic_year_id: data.academicYear || data.academic_year_id,
        homeroom_teacher_id: data.homeroomTeacherId || data.homeroom_teacher_id || null,
        status: data.status || 'Active'
      };
      const res = await apiFetch(`/classes/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return { success: true, message: res.message, class: res.data };
    },

    // 17. Classes: setClassStatus
    setClassStatus: async function (classId, status) {
      const res = await apiFetch(`/classes/${encodeURIComponent(classId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      return { success: true, message: res.message, class: res.data };
    },

    // 18. Classes: getClassAttendanceRoster (BUG 29)
    getClassAttendanceRoster: async function (...args) {
      let classId = null;
      if (args.length >= 2) {
        classId = args[1];
      } else if (args.length === 1) {
        classId = typeof args[0] === 'object' ? (args[0].class_id || args[0].classId) : args[0];
      }
      const [clsRes, rosterRes] = await Promise.all([
        apiFetch(`/classes/${encodeURIComponent(classId)}`),
        apiFetch(`/classes/${encodeURIComponent(classId)}/roster`)
      ]);
      const cls = clsRes.data || {};
      const roster = rosterRes.data || [];
      const today = new Date().toISOString().split('T')[0];
      const students = roster.map((r) => ({
        studentId: r.student_id,
        name: r.name,
        nis: r.nis,
        status: r.attendance_status || 'Hadir'
      }));
      return {
        success: true,
        date: today,
        class: {
          classId: cls.class_id || classId,
          className: cls.class_name || classId,
          academicYear: cls.academic_year_id || '2026/2027'
        },
        students: students,
        roster: roster,
        totalStudents: students.length
      };
    },

    // 19. Students: getStudents
    getStudents: async function (classIdOrFilters) {
      let q = '';
      if (typeof classIdOrFilters === 'string') {
        q = `?class_id=${encodeURIComponent(classIdOrFilters)}`;
      } else if (typeof classIdOrFilters === 'object' && classIdOrFilters !== null) {
        const params = new URLSearchParams();
        if (classIdOrFilters.class_id || classIdOrFilters.classId) {
          params.append('class_id', classIdOrFilters.class_id || classIdOrFilters.classId);
        }
        if (classIdOrFilters.search) params.append('search', classIdOrFilters.search);
        if (classIdOrFilters.status) params.append('status', classIdOrFilters.status);
        const qs = params.toString();
        if (qs) q = `?${qs}`;
      }
      const res = await apiFetch(`/students${q}`);
      const students = (res.data || []).map((s) => ({
        studentId: s.student_id,
        name: s.name,
        nis: s.nis,
        nisn: s.nisn,
        gender: s.gender,
        classId: s.class_id,
        status: s.status,
        qrCodeId: s.qr_code_id,
        birthDate: s.birth_date,
        ...s
      }));
      return { success: true, students: students };
    },

    // 20. Students: getStudentById
    getStudentById: async function (studentId) {
      const res = await apiFetch(`/students/${encodeURIComponent(studentId)}`);
      const s = res.data;
      const studentObj = {
        studentId: s.student_id,
        name: s.name,
        nis: s.nis,
        nisn: s.nisn,
        gender: s.gender,
        classId: s.class_id,
        status: s.status,
        qrCodeId: s.qr_code_id,
        birthDate: s.birth_date,
        ...s
      };
      return { success: true, student: studentObj };
    },

    // 21. Students: createStudent
    createStudent: async function (...args) {
      const data = args.find((a) => a && typeof a === 'object') || {};
      const sId = data.studentId || data.student_id;
      const payload = {
        student_id: sId,
        name: data.name,
        nis: data.nis || null,
        nisn: data.nisn || null,
        gender: data.gender || 'L',
        class_id: data.classId || data.class_id,
        qr_code_id: data.qrCodeId || data.qr_code_id || (sId ? `SQR-${sId}` : (data.nis ? `SQR-${data.nis}` : `SQR-${Date.now()}`)),
        status: data.status || 'Active',
        birth_date: data.birthDate || data.birth_date || null
      };
      const res = await apiFetch('/students', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return { success: true, message: res.message, student: res.data };
    },

    // 22. Students: updateStudent
    updateStudent: async function (...args) {
      let id = null;
      let data = {};
      if (args.length >= 3) {
        id = args[1];
        data = args[2] || {};
      } else if (args.length === 2) {
        if (typeof args[1] === 'object') {
          id = args[0];
          data = args[1];
        } else {
          id = args[1];
          data = {};
        }
      } else if (args.length === 1 && typeof args[0] === 'object') {
        data = args[0];
        id = data.studentId || data.student_id || data.id;
      }
      const payload = {
        name: data.name,
        nis: data.nis || null,
        nisn: data.nisn || null,
        gender: data.gender || undefined,
        class_id: data.classId || data.class_id,
        status: data.status || 'Active',
        birth_date: data.birthDate || data.birth_date || null
      };
      const res = await apiFetch(`/students/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return { success: true, message: res.message, student: res.data };
    },

    // 23. Students: setStudentStatus
    setStudentStatus: async function (studentId, status) {
      const res = await apiFetch(`/students/${encodeURIComponent(studentId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      return { success: true, message: res.message, student: res.data };
    },

    // 24. Students: lookupStudentByQr
    lookupStudentByQr: async function (...args) {
      const qrCodeId = args.length === 1 ? args[0] : args[args.length - 1];
      const res = await apiFetch(`/students/qr/${encodeURIComponent(qrCodeId)}`);
      const s = res.data;
      const studentObj = {
        studentId: s.student_id,
        name: s.name,
        nis: s.nis,
        nisn: s.nisn,
        gender: s.gender,
        classId: s.class_id,
        status: s.status,
        qrCodeId: s.qr_code_id,
        ...s
      };
      return { success: true, student: studentObj };
    },

    // 25. StudentAttendance: getStudentAttendance
    getStudentAttendance: async function (filters = {}) {
      const params = new URLSearchParams();
      if (filters.student_id || filters.studentId) params.append('student_id', filters.student_id || filters.studentId);
      if (filters.class_id || filters.classId) params.append('class_id', filters.class_id || filters.classId);
      if (filters.date || filters.attendance_date) params.append('date', filters.date || filters.attendance_date);
      if (filters.period) params.append('period', filters.period);
      if (filters.status) params.append('status', filters.status);
      const qs = params.toString();
      const res = await apiFetch(`/attendance/students${qs ? '?' + qs : ''}`);
      const list = (res.data || []).map((a) => ({
        attendanceId: a.attendance_id,
        studentId: a.student_id,
        studentName: a.student_name || a.name || a.student_id,
        classId: a.class_id,
        className: a.class_name || a.class_id,
        date: normalizeCalendarDate(a.attendance_date || a.date),
        period: a.period,
        status: a.status,
        method: a.method,
        note: a.note || '',
        timestamp: a.recorded_at,
        ...a
      }));
      return { success: true, attendances: list, data: list };
    },

    // 26. StudentAttendance: getStudentAttendanceById
    getStudentAttendanceById: async function (id) {
      const res = await apiFetch(`/attendance/students/${encodeURIComponent(id)}`);
      const a = res.data;
      const obj = {
        attendanceId: a.attendance_id,
        studentId: a.student_id,
        studentName: a.student_name || a.name,
        classId: a.class_id,
        className: a.class_name,
        date: normalizeCalendarDate(a.attendance_date || a.date),
        period: a.period,
        status: a.status,
        method: a.method,
        note: a.note || '',
        ...a
      };
      return { success: true, attendance: obj };
    },

    // 27. StudentAttendance: createStudentAttendance
    createStudentAttendance: async function (data) {
      const payload = {
        student_id: data.studentId || data.student_id,
        attendance_date: data.date || data.attendance_date || new Date().toISOString().split('T')[0],
        period: parseInt(data.period, 10),
        status: data.status || 'Hadir',
        method: data.method || 'MANUAL',
        note: data.note || null
      };
      const res = await apiFetch('/attendance/students', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return { success: true, message: res.message, data: res.data };
    },

    // 28. StudentAttendance: updateStudentAttendance
    updateStudentAttendance: async function (data) {
      const id = data.attendanceId || data.attendance_id || data.id;
      const payload = {
        status: data.status,
        note: data.note,
        period: data.period !== undefined ? parseInt(data.period, 10) : (data.periods ? parseInt(data.periods[0], 10) : undefined),
        attendance_date: data.date || data.attendance_date
      };
      const res = await apiFetch(`/attendance/students/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return { success: true, message: res.message, data: res.data };
    },

    // 29. StudentAttendance: recordStudentAttendanceFromQr
    recordStudentAttendanceFromQr: async function (...args) {
      let qrCodeId, status = 'Hadir', note = '', periods = [];
      if (args.length >= 6) {
        qrCodeId = args[2];
        status = args[3] || 'Hadir';
        note = args[4] || '';
        periods = args[5];
      } else if (args.length === 4) {
        qrCodeId = args[1];
        periods = [args[2]];
        note = args[3] || '';
      } else if (typeof args[0] === 'object') {
        const obj = args[0];
        qrCodeId = obj.qr_code_id || obj.qrCodeId;
        status = obj.status || 'Hadir';
        note = obj.note || '';
        periods = obj.periods || [obj.period];
      }

      if (!Array.isArray(periods)) {
        periods = [periods];
      }

      const studentRes = await apiFetch(`/students/qr/${encodeURIComponent(qrCodeId)}`);
      const student = studentRes.data;

      const results = [];
      for (const p of periods) {
        const res = await apiFetch('/attendance/students/qr', {
          method: 'POST',
          body: JSON.stringify({
            qr_code_id: qrCodeId,
            period: parseInt(p, 10),
            status,
            note
          })
        });
        results.push(res.data);
      }

      return {
        success: true,
        message: `Presensi siswa berhasil dicatat untuk ${periods.length} jam pelajaran.`,
        count: results.length,
        periods: periods.map((p) => parseInt(p, 10)),
        attendance: results[0],
        attendances: results,
        student: {
          studentId: student.student_id,
          name: student.name,
          nis: student.nis,
          classId: student.class_id,
          status
        }
      };
    },

    // 30. StudentAttendance: recordBatchClassAttendance
    recordBatchClassAttendance: async function (...args) {
      const payload = args.find((a) => a && typeof a === 'object' && (a.classId || a.class_id || a.attendances)) || args[args.length - 1];
      const targetPayload = {
        class_id: payload.class_id || payload.classId,
        attendance_date: payload.attendance_date || payload.date || new Date().toISOString().split('T')[0],
        periods: (payload.periods || []).map((p) => parseInt(p, 10)),
        attendances: (payload.attendances || []).map((a) => ({
          student_id: a.student_id || a.studentId,
          status: a.status || 'Hadir',
          note: a.note || ''
        })),
        method: payload.method || 'QR_BATCH'
      };
      const res = await apiFetch('/attendance/students/batch', {
        method: 'POST',
        body: JSON.stringify(targetPayload)
      });
      return { success: true, message: res.message, data: res.data };
    },

    // 31. StudentAttendance: recordBatchAttendance (Alias)
    recordBatchAttendance: async function (...args) {
      return functionDefinitions.recordBatchClassAttendance(...args);
    },

    // 32. TeacherAttendance: getTeacherAttendance
    getTeacherAttendance: async function (filters = {}) {
      const params = new URLSearchParams();
      if (filters.teacher_id || filters.teacherId) params.append('teacher_id', filters.teacher_id || filters.teacherId);
      if (filters.class_id || filters.classId) params.append('class_id', filters.class_id || filters.classId);
      if (filters.date || filters.attendance_date) params.append('date', filters.date || filters.attendance_date);
      if (filters.period) params.append('period', filters.period);
      if (filters.status) params.append('status', filters.status);
      const qs = params.toString();
      const res = await apiFetch(`/attendance/teachers${qs ? '?' + qs : ''}`);
      const list = (res.data || []).map((a) => ({
        attendanceId: a.attendance_id,
        teacherId: a.teacher_id,
        teacherName: a.teacher_name || a.name || a.teacher_id,
        classId: a.class_id,
        className: a.class_name || a.class_id,
        date: normalizeCalendarDate(a.attendance_date || a.date),
        period: a.period,
        subject: a.subject,
        materi: a.materi,
        status: a.status,
        note: a.note || '',
        timestamp: a.recorded_at,
        ...a
      }));
      return { success: true, attendances: list, data: list };
    },

    // 33. TeacherAttendance: getTeacherAttendanceById
    getTeacherAttendanceById: async function (id) {
      const res = await apiFetch(`/attendance/teachers/${encodeURIComponent(id)}`);
      const a = res.data;
      const obj = {
        attendanceId: a.attendance_id,
        teacherId: a.teacher_id,
        teacherName: a.teacher_name || a.name,
        classId: a.class_id,
        className: a.class_name,
        date: normalizeCalendarDate(a.attendance_date || a.date),
        period: a.period,
        subject: a.subject,
        materi: a.materi,
        status: a.status,
        note: a.note || '',
        ...a
      };
      return { success: true, attendance: obj };
    },

    // 34. TeacherAttendance: updateTeacherAttendance
    updateTeacherAttendance: async function (data) {
      const id = data.attendanceId || data.attendance_id || data.id;
      const payload = {
        status: data.status,
        subject: data.subject,
        materi: data.materi,
        note: data.note,
        period: data.period !== undefined ? parseInt(data.period, 10) : undefined,
        class_id: data.classId || data.class_id,
        attendance_date: data.date || data.attendance_date
      };
      const res = await apiFetch(`/attendance/teachers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return { success: true, message: res.message, data: res.data };
    },

    // 35. TeacherAttendance: recordTeacherAttendanceFromResponder (Multi-Hour + Single Photo)
    recordTeacherAttendanceFromResponder: async function (...args) {
      const p = args.find((a) => a && typeof a === 'object' && (a.teacherId || a.teacher_id || a.photoDataUrl || a.photo)) || {};
      const teacherId = p.teacher_id || p.teacherId;
      const classId = p.class_id || p.classId;
      const periods = p.periods;
      const subject = p.subject;
      const materi = p.materi;
      const note = p.note || '';
      const status = p.status || 'Hadir';
      const attendanceDate = p.attendance_date || p.attendanceDate;
      let sessionId = p.session_id || p.sessionId;

      if (!sessionId && window.currentResponderSession) {
        sessionId = window.currentResponderSession.sessionId || window.currentResponderSession.session_id;
      }

      if (!sessionId) {
        try {
          const sessRes = await apiFetch('/responder/sessions', { method: 'POST' });
          sessionId = sessRes.data.session_id;
        } catch (_) {}
      }

      const formData = new FormData();
      formData.append('teacher_id', teacherId);
      formData.append('class_id', classId);
      formData.append('subject', subject);
      formData.append('materi', materi);
      formData.append('status', status);
      if (note) formData.append('note', note);
      if (attendanceDate) formData.append('attendance_date', attendanceDate);
      if (sessionId) formData.append('session_id', sessionId);

      if (Array.isArray(periods)) {
        formData.append('periods', JSON.stringify(periods));
      } else if (periods !== undefined) {
        formData.append('periods', String(periods));
      }

      const photoVal = p.photo || p.photoDataUrl;
      if (photoVal instanceof Blob) {
        formData.append('photo', photoVal, 'evidence.jpg');
      } else if (typeof photoVal === 'string' && photoVal.startsWith('data:image/')) {
        const blob = dataURLtoBlob(photoVal);
        if (blob) {
          formData.append('photo', blob, 'evidence.jpg');
        }
      }

      const res = await apiFetch('/attendance/teachers', {
        method: 'POST',
        body: formData
      });
      return { success: true, message: res.message, data: res.data };
    },

    // 36. Responder: createResponderSession
    createResponderSession: async function (token) {
      const res = await apiFetch('/responder/sessions', { method: 'POST' });
      const opId = res.data.operator_id || res.data.username || res.data.operator_user_id || res.data.created_by;
      return {
        success: true,
        sessionId: res.data.session_id,
        session: {
          sessionId: res.data.session_id,
          session_id: res.data.session_id,
          operatorId: opId,
          operator_id: opId,
          operatorUserId: res.data.operator_user_id,
          operatorName: res.data.operator_name,
          status: res.data.status,
          created_at: res.data.created_at
        }
      };
    },

    // 37. Responder: finishResponderSession
    finishResponderSession: async function (token, sessionId) {
      const sId = sessionId || token;
      const res = await apiFetch(`/responder/sessions/${encodeURIComponent(sId)}/finish`, { method: 'POST' });
      return { success: true, message: res.message, session: res.data };
    },

    // 38. Responder: cancelResponderSession
    cancelResponderSession: async function (token, sessionId) {
      const sId = sessionId || token;
      const res = await apiFetch(`/responder/sessions/${encodeURIComponent(sId)}/cancel`, { method: 'POST' });
      return { success: true, message: res.message, session: res.data };
    },

    // 39. Evidence: getTeacherPhotoEvidenceByDate
    getTeacherPhotoEvidenceByDate: async function (token, date) {
      const d = date || token;
      const res = await apiFetch(`/attendance/teachers?date=${encodeURIComponent(d)}`);
      const attendances = res.data || [];
      const records = attendances.map((a) => {
        const hasPhoto = Boolean(a.file_id || a.evidence_id || a.file_url);
        const nikDisplay = (a.nik && a.nik !== '-') ? a.nik : ((a.nip && a.nip !== '-') ? a.nip : ((a.nuptk && a.nuptk !== '-') ? a.nuptk : '-'));
        return {
          attendanceId: a.attendance_id,
          teacherId: a.teacher_id,
          teacherName: a.teacher_name || a.name || a.teacher_id,
          nik: nikDisplay,
          classId: a.class_id,
          className: a.class_name || a.class_id,
          period: a.period,
          date: normalizeCalendarDate(a.attendance_date || a.date),
          subject: a.subject,
          materi: a.materi,
          status: a.status,
          timestamp: a.recorded_at || a.timestamp || null,
          recordedAt: a.recorded_at || null,
          hasPhoto: hasPhoto,
          fileId: a.file_id || a.evidence_id || null,
          fileUrl: a.file_url || null,
          evidenceId: a.evidence_id || null
        };
      });
      return {
        success: true,
        records: records,
        evidences: records
      };
    },

    // 40. Evidence: getTeacherPhotoDetail
    getTeacherPhotoDetail: async function (token, attendanceId) {
      const attId = attendanceId || token;
      const res = await apiFetch(`/evidences/attendance/${encodeURIComponent(attId)}`);
      const evidence = res.data;
      if (!evidence || !evidence.file_id) {
        return {
          success: false,
          message: 'Bukti foto tidak ditemukan untuk presensi ini.',
          evidence: null,
          photoDataUrl: ''
        };
      }
      return {
        success: true,
        photoDataUrl: `/api/v1/evidences/file/${evidence.file_id}`,
        evidence: evidence
      };
    },

    // 41. Dashboard: getDashboardData
    getDashboardData: async function (token, date) {
      const q = date ? `?date=${encodeURIComponent(date)}` : '';
      let currentUser = null;
      try {
        const meRes = await apiFetch('/auth/me');
        currentUser = meRes.data.user;
      } catch (_) {}

      const res = await apiFetch(`/dashboard${q}`);
      const d = res.data || {};
      const counts = d.counts || {};
      const att = d.student_attendance || {};

      return {
        success: true,
        data: d,
        user: {
          name: currentUser ? (currentUser.full_name || currentUser.username) : 'User SIMATA',
          username: currentUser ? currentUser.username : '',
          role: currentUser ? currentUser.role : 'Guru'
        },
        statistics: {
          students: counts.students || 0,
          teachers: counts.teachers || 0,
          classes: counts.classes || 0,
          attendance: att.hadir || att.total_recorded || 0
        },
        ...d
      };
    },

    // 42. Chatbot: sendChatbotMessage
    sendChatbotMessage: async function (token, prompt, opts) {
      const p = typeof prompt === 'string' ? prompt : (token || '');
      const res = await apiFetch('/chatbot/message', {
        method: 'POST',
        body: JSON.stringify({ message: p })
      });
      return {
        success: true,
        reply: res.data.reply,
        response: res.data.reply,
        hasData: res.data.has_data || false,
        ...res.data
      };
    },

    // 43. Legacy Grades compatibility stubs
    getGrades: async function (filters) {
      return { success: true, grades: [] };
    },
    getGradeById: async function (gradeId) {
      return { success: false, message: 'Data nilai belum diaktifkan pada migrasi ini.' };
    },
    createGrade: async function (payload) {
      return { success: false, message: 'Fitur input nilai belum diaktifkan pada migrasi ini.' };
    },
    updateGrade: async function (payload) {
      return { success: false, message: 'Fitur update nilai belum diaktifkan pada migrasi ini.' };
    },

    // 42. Profile Photos: FEATURE 01
    getStudentPhotoBlob: async function (studentId) {
      const token = getStoredToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await window.fetch(`${API_BASE}/students/${encodeURIComponent(studentId)}/photo`, {
        method: 'GET',
        headers
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Gagal memuat pasfoto siswa (HTTP ${res.status})`);
      return await res.blob();
    },

    getTeacherPhotoBlob: async function (teacherId) {
      const token = getStoredToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await window.fetch(`${API_BASE}/teachers/${encodeURIComponent(teacherId)}/photo`, {
        method: 'GET',
        headers
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Gagal memuat pasfoto guru (HTTP ${res.status})`);
      return await res.blob();
    },

    getStudentPhotoMeta: async function (studentId) {
      try {
        const res = await apiFetch(`/students/${encodeURIComponent(studentId)}/photo/meta`);
        return { success: true, data: res.data };
      } catch (err) {
        return { success: false, data: null };
      }
    },

    getTeacherPhotoMeta: async function (teacherId) {
      try {
        const res = await apiFetch(`/teachers/${encodeURIComponent(teacherId)}/photo/meta`);
        return { success: true, data: res.data };
      } catch (err) {
        return { success: false, data: null };
      }
    },

    updateStudentPhotoFraming: async function (studentId, framing) {
      const res = await apiFetch(`/students/${encodeURIComponent(studentId)}/photo/framing`, {
        method: 'PATCH',
        body: JSON.stringify({
          crop_scale: framing.crop_scale,
          crop_position_x: framing.crop_position_x,
          crop_position_y: framing.crop_position_y
        })
      });
      return { success: true, message: res.message, data: res.data };
    },

    updateTeacherPhotoFraming: async function (teacherId, framing) {
      const res = await apiFetch(`/teachers/${encodeURIComponent(teacherId)}/photo/framing`, {
        method: 'PATCH',
        body: JSON.stringify({
          crop_scale: framing.crop_scale,
          crop_position_x: framing.crop_position_x,
          crop_position_y: framing.crop_position_y
        })
      });
      return { success: true, message: res.message, data: res.data };
    },

    uploadStudentPhoto: async function (studentId, fileOrBlob, cropData = null) {
      const formData = new FormData();
      formData.append('photo', fileOrBlob);
      if (cropData) {
        if (cropData.crop_scale !== undefined) formData.append('crop_scale', cropData.crop_scale);
        if (cropData.crop_position_x !== undefined) formData.append('crop_position_x', cropData.crop_position_x);
        if (cropData.crop_position_y !== undefined) formData.append('crop_position_y', cropData.crop_position_y);
      }
      const res = await apiFetch(`/students/${encodeURIComponent(studentId)}/photo`, {
        method: 'POST',
        body: formData
      });
      return { success: true, message: res.message, data: res.data };
    },

    uploadTeacherPhoto: async function (teacherId, fileOrBlob, cropData = null) {
      const formData = new FormData();
      formData.append('photo', fileOrBlob);
      if (cropData) {
        if (cropData.crop_scale !== undefined) formData.append('crop_scale', cropData.crop_scale);
        if (cropData.crop_position_x !== undefined) formData.append('crop_position_x', cropData.crop_position_x);
        if (cropData.crop_position_y !== undefined) formData.append('crop_position_y', cropData.crop_position_y);
      }
      const res = await apiFetch(`/teachers/${encodeURIComponent(teacherId)}/photo`, {
        method: 'POST',
        body: formData
      });
      return { success: true, message: res.message, data: res.data };
    },

    downloadStudentPhoto: async function (studentId, studentName) {
      const token = getStoredToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await window.fetch(`${API_BASE}/students/${encodeURIComponent(studentId)}/photo?download=1`, {
        method: 'GET',
        headers
      });
      if (!res.ok) throw new Error(`Gagal mengunduh pasfoto siswa (HTTP ${res.status})`);
      const disposition = res.headers.get('content-disposition') || '';
      let filename = `pasfoto_${studentId}.jpg`;
      const match = disposition.match(/filename="?([^";]+)"?/);
      if (match && match[1]) filename = match[1];
      const blob = await res.blob();
      const objUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(objUrl);
      }, 300);
      return { success: true, filename };
    },

    downloadTeacherPhoto: async function (teacherId, teacherName) {
      const token = getStoredToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await window.fetch(`${API_BASE}/teachers/${encodeURIComponent(teacherId)}/photo?download=1`, {
        method: 'GET',
        headers
      });
      if (!res.ok) throw new Error(`Gagal mengunduh pasfoto guru (HTTP ${res.status})`);
      const disposition = res.headers.get('content-disposition') || '';
      let filename = `pasfoto_${teacherId}.jpg`;
      const match = disposition.match(/filename="?([^";]+)"?/);
      if (match && match[1]) filename = match[1];
      const blob = await res.blob();
      const objUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(objUrl);
      }, 300);
      return { success: true, filename };
    },

    deleteStudentPhoto: async function (studentId) {
      const res = await apiFetch(`/students/${encodeURIComponent(studentId)}/photo`, {
        method: 'DELETE'
      });
      return { success: true, message: res.message };
    },

    deleteTeacherPhoto: async function (teacherId) {
      const res = await apiFetch(`/teachers/${encodeURIComponent(teacherId)}/photo`, {
        method: 'DELETE'
      });
      return { success: true, message: res.message };
    }
  };

  /**
   * Dual-mode client proxy supporting:
   * 1. .withSuccessHandler(cb).withFailureHandler(errCb).method(...args)
   * 2. direct Promise calls: await simataClient.method(...args)
   */
  function createProxy(successHandler, failureHandler) {
    return new Proxy({}, {
      get: function (target, prop) {
        if (prop === 'withSuccessHandler') {
          return function (cb) {
            return createProxy(cb, failureHandler);
          };
        }
        if (prop === 'withFailureHandler') {
          return function (cb) {
            return createProxy(successHandler, cb);
          };
        }

        return function (...args) {
          const fn = functionDefinitions[prop];
          if (!fn) {
            const err = new Error(`Fungsi client '${String(prop)}' tidak dikenali di REST Adapter SIMATA.`);
            if (failureHandler) {
              queueMicrotask(() => {
                try { failureHandler(err); } catch (e) { console.error(e); }
              });
            } else {
              console.error(err);
            }
            return Promise.reject(err);
          }

          const promise = fn(...args);
          promise
            .then((result) => {
              if (successHandler) {
                try {
                  successHandler(result);
                } catch (e) {
                  console.error('[SIMATA SuccessHandler Error]:', e);
                }
              }
            })
            .catch((err) => {
              if (failureHandler) {
                try {
                  failureHandler(err);
                } catch (e) {
                  console.error('[SIMATA FailureHandler Error]:', e);
                }
              } else {
                console.error(`[SIMATA Client Error] ${String(prop)}:`, err);
              }
            });

          return promise;
        };
      }
    });
  }

  // Register modern first-class client on window object
  const clientProxy = createProxy();
  window.simataClient = clientProxy;
  window.SIMATA_CLIENT = {
    apiFetch,
    getStoredToken,
    setStoredToken,
    dataURLtoBlob,
    functionDefinitions,
    client: clientProxy
  };

  // Compatibility alias for transition
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = clientProxy;

  console.info('[SIMATA] Modern REST Client (simata-client.js) initialized. Active functions ready.');
})(typeof window !== 'undefined' ? window : globalThis);
