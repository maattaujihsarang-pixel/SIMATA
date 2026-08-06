/**
 * Dashboard Backend
 * SIMATA v0.1.1-dev
 * Sprint 2 - Commit 006
 */

/**
 * Mengambil data awal Dashboard
 */
function getDashboardData() {

  return {
    success: true,

    user: {
      name: "Imam Maulana",
      role: "Administrator"
    },

    statistics: {
      students: 0,
      teachers: 0,
      attendance: 0,
      classes: 0
    }
    
  };

}