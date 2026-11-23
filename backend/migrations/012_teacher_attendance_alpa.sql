-- 012_teacher_attendance_alpa.sql
-- BUG 68: Allow 'Alpa' status in teacher_attendance and align status check constraint

ALTER TABLE teacher_attendance
  DROP CONSTRAINT IF EXISTS teacher_attendance_status_check;

ALTER TABLE teacher_attendance
  ADD CONSTRAINT teacher_attendance_status_check
  CHECK (status IN ('Hadir', 'Izin', 'Sakit', 'Alpa', 'TugasLuar'));
