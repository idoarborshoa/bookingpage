const SUPABASE_URL = 'https://osgmpmkqiwuixqnttllc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zZ21wbWtxaXd1aXhxbnR0bGxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMDc4MTQsImV4cCI6MjEwMTY4MzgxNH0.Uvz672RY9HtQIsfFLptm3YqXl8ICHbDUgFM_NYrskWw';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const MAX_DAYS_SCHEDULE_INTO_FUTURE = 30; // Maximum days into the future a booking can be made
const loadingElement = document.getElementById("loading");
const alertType = Object.freeze({
    primary: 'primary',
    secondary: 'secondary',
    success: 'success',
    danger: 'danger',
    warning: 'warning',
    info: 'info'
});
const hash = window.location.hash;
const isInviteOrRecovery = hash.includes('type=invite') || hash.includes('type=recovery');
analyzeHashParams();

supabaseClient.auth.onAuthStateChange(async (event, session) => {
    // Trigger if we detected an invite/recovery flow on page load
    if (isInviteOrRecovery && session) {
        // Flag to ensure prompt only runs once
        if (!window.passwordPromptShown) {
            window.passwordPromptShown = true;

            document.getElementById('changePasswordForm').reset();
            changePasswordModal.show();
            /*
            const newPassword = prompt('Welcome! Please set your new password:');
            //TODO: change to use the new password form

            if (newPassword) {
              const { error } = await supabaseClient.auth.updateUser({ password: newPassword });

              if (!error) {
                showAlert('Password saved successfully! Welcome to the portal.', alertType.success);
                // Clean the URL by redirecting to pure pathname
                window.location.href = window.location.origin + window.location.pathname;
              } else {
                showAlert('Failed to set password: ' + error.message, alertType.danger);
              }
            }
              */
        }
    }
});

const COLORS = ['#0d6efd', '#6f42c1', '#d63384', '#fd7e14', '#20c997', '#0dcaf0', '#6c757d', '#dc3545'];
const SAMPLE_SCHEDULE_JSON = JSON.stringify({
    monday: [{
        start: '08:30',
        end: '22:00'
    }],
    tuesday: [{
        start: '08:30',
        end: '22:00'
    }],
    wednesday: [{
        start: '08:30',
        end: '22:00'
    }],
    thursday: [{
        start: '08:30',
        end: '22:00'
    }],
    friday: [{
        start: '08:30',
        end: '22:00'
    }],
    saturday: [{
        start: '08:30',
        end: '22:00'
    }],
    sunday: [{
        start: '08:30',
        end: '22:00'
    }]
});

let calendar = null;
let currentUser = null;
let bookingModal = null;
let adminUserModal = null;
let resetPasswordModal = null;
let changePasswordModal = null;
let activeEventId = null;
let isSuperAdmin = false;
let showOnlyMyBookings = false;
let currentView = 'booking';
let adminUsersCache = [];
let pendingPasswordResetUser = null;
const amenityColors = {}; // amenity_id → { color, name }

// --- load helpers
function analyzeHashParams() {
    const params = new URLSearchParams(hash.substring(1)); // Remove the '#' character
    const result = {
        type: params.get('type'),
        access_token: params.get('access_token'),
        refresh_token: params.get('refresh_token'),
        expires_in: params.get('expires_in'),
        error: params.get('error'),
        error_code: params.get('error_code'),
        error_description: params.get('error_description')
    };
    if (result.error) {
        showAlert(`Authentication error: ${result.error} - ${result.error_code} - ${result.error_description}`, alertType.danger);
    }
}

// ── UI helpers ────────────────────────────────────────────────────────────

async function flipForm(shouldDisable) {
    //console.log('setting form to '+(shouldDisable ? 'disabled' : 'enabled')+' state');
    return new Promise(resolve => {
        if (shouldDisable) {
            loadingElement.classList.remove('d-none');
        } else {
            loadingElement.classList.add('d-none');
        }
        resolve();
    });

}

function showLoginUI() {
    document.getElementById('loginSection').classList.remove('d-none');
    document.getElementById('bookingSection').classList.add('d-none');
    document.getElementById('legendSection').classList.add('d-none');
    document.getElementById('authStatus').textContent = 'Not logged in';
    document.getElementById('changePasswordBtn').classList.add('d-none');
    document.getElementById('logoutBtn').classList.add('d-none');
    document.getElementById('calendarPlaceholder').classList.remove('d-none');
    document.getElementById('calendar').classList.add('d-none');
    document.getElementById('viewSwitcher').classList.add('d-none');
    document.getElementById('adminView').classList.add('d-none');
    document.getElementById('bookingView').classList.remove('d-none');
    document.getElementById('calendarToolbar').classList.add('d-none');
    document.getElementById('calendarToolbar').classList.remove('d-flex');
    showOnlyMyBookings = false;
    const myBookingsOnlySwitch = document.getElementById('myBookingsOnlySwitch');
    if (myBookingsOnlySwitch) myBookingsOnlySwitch.checked = false;
    currentUser = null;
    isSuperAdmin = false;
    currentView = 'booking';
    if (calendar) {
        calendar.destroy();
        calendar = null;
    }
}

async function checkSuperAdminStatus(userId) {
    try {
        const {
            data,
            error
        } = await supabaseClient.rpc('is_superadmin', {
            user_id: userId
        });
        if (error) {
            console.warn('is_superadmin RPC unavailable:', error.message);
            return false;
        }
        return !!data;
    } catch (err) {
        console.warn('is_superadmin RPC check failed:', err);
        return false;
    }
}

async function showBookingUI(user) {
    currentUser = user;
    console.log('Logged in user:', user);
    isSuperAdmin = await checkSuperAdminStatus(user.id);
    document.getElementById('bookingDate').value = getTomorrowDateString();
    syncBookingDateConstraints();
    document.getElementById('loginSection').classList.add('d-none');
    document.getElementById('authStatus').innerHTML = `Hello <span class="fw-bold">${user.user_metadata.name}</span><span class="text-muted"> (${user.email ? user.email : 'no email on record'}) ${isSuperAdmin ? ' • Super admin' : ''}</span>`;
    document.getElementById('changePasswordBtn').classList.remove('d-none');
    document.getElementById('logoutBtn').classList.remove('d-none');
    document.getElementById('viewSwitcher').classList.toggle('d-none', !isSuperAdmin);
    await loadAmenities();
    document.getElementById('legendSection').classList.remove('d-none');
    document.getElementById('calendarPlaceholder').classList.add('d-none');
    document.getElementById('calendar').classList.remove('d-none');
    document.getElementById('calendarToolbar').classList.remove('d-none');
    document.getElementById('calendarToolbar').classList.add('d-flex');
    setActiveView('booking');
    if (isSuperAdmin) {
        await loadAdminData();
    }
    initCalendar();
}

function showAlert(message, type, autoHideTimeout = 5000) {
    /*
        'primary
        'secondary
        'success
        'danger
        'warning
        'info
        'light
        'dark
    */

    const alertDiv = document.createElement('div');
    alertDiv.classList.add("alert");
    alertDiv.classList.add("alert-" + type);
    alertDiv.classList.add("alert-dismissible");
    alertDiv.classList.add("show");
    alertDiv.classList.add("in");
    alertDiv.classList.add("fade");
    alertDiv.innerHTML = '<div>' + message + '</div><button type="button" class="btn btn-close" data-bs-dismiss="alert" aria-label="Close"></button></div>';
    document.getElementById("alertplaceholder").appendChild(alertDiv);
    if (autoHideTimeout > 1) {
        new bootstrap.Alert(alertDiv);
        setTimeout(() => {
            bootstrap.Alert.getInstance(alertDiv).close();
        }, +autoHideTimeout);
    }
}

function setActiveView(view) {
    currentView = view;
    const bookingSection = document.getElementById('bookingSection');
    const legendSection = document.getElementById('legendSection');
    const bookingView = document.getElementById('bookingView');
    const adminView = document.getElementById('adminView');
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    if (view === 'admin') {
        bookingSection.classList.add('d-none');
        legendSection.classList.add('d-none');
        bookingView.classList.add('d-none');
        adminView.classList.remove('d-none');
        adminView.classList.add('active');
    } else {
        bookingSection.classList.remove('d-none');
        legendSection.classList.remove('d-none');
        bookingView.classList.remove('d-none');
        adminView.classList.add('d-none');
        adminView.classList.remove('active');
    }
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    } [char]));
}

function normalizeAdminUser(item) {
    const source = item.raw || item;
    const id = source.id || source.user_id || source.uuid || source.userId || source.user_uuid || source.userid || null;
    const name = source.name || source.full_name || source.display_name || source.username || '';
    const email = source.email || source.user_email || '';
    const isSuperAdmin = source.is_superadmin ?? source.isAdmin ?? source.is_admin ?? source.role === 'superadmin' ?? false;
    const unitNumber = source.unit_number || source.unitNumber || 'N/A';
    const createdAt = source.created_at || source.createdAt || source.created || source.inserted_at || '';
    const isBanned = source.is_banned ?? source.isBanned ?? source.banned ?? true;
    const lastLogin = source.last_sign_in_at ? new Date(source.last_sign_in_at).toLocaleString() : 'Never logged in';
    return {
        id,
        name,
        email,
        isSuperAdmin,
        unitNumber,
        createdAt,
        isBanned,
        lastLogin,
        raw: source
    };
}

function renderAdminUsers() {
    const tableBody = document.getElementById('adminUserTableBody');
    const status = document.getElementById('adminUserStatus');
    const searchValue = document.getElementById('adminUserSearch').value.trim().toLowerCase();
    const normalizeSearchText = (value) => String(value || '')
        .toLowerCase()
        .replace(/[()\[\]{}#.,_-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!tableBody) return;

    const filteredUsers = adminUsersCache.filter(user => {
        const haystack = [user.id, user.name, user.email, user.unitNumber].filter(Boolean).join(' ');
        const normalizedHaystack = normalizeSearchText(haystack);
        const normalizedSearchValue = normalizeSearchText(searchValue);
        return !normalizedSearchValue || normalizedHaystack.includes(normalizedSearchValue);
    });

    if (!filteredUsers.length) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-muted">No users found.</td></tr>';
        status.textContent = 'No matching users.';
        return;
    }

    tableBody.innerHTML = filteredUsers.map(user => {
        const isSelf = !!(currentUser && user.id && currentUser.id === user.id);
        return `
          <tr>
            <td>
              <div class="fw-semibold">${escapeHtml(user.name || 'Unnamed user')} (${escapeHtml(user.unitNumber || 'N/A')}) ${user.isBanned ? '<span class="badge bg-warning">DISABLED</span>' : ''}</div>
              <div class="small text-muted">${escapeHtml(user.lastLogin)}</div>
            </td>
            <td>
              ${escapeHtml(user.email || '—')}
              <div class="small text-muted">${escapeHtml(user.id || 'No UUID')}</div>
            </td>
            <td>${user.isSuperAdmin ? '<span class="badge bg-danger">Super admin</span>' : '<span class="badge bg-secondary">User</span>'}</td>
            <td>${escapeHtml(user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—')}</td>
            <td>
              <div class="btn-group btn-group-sm">
                <button class="btn btn-secondary icon-btn" type="button" data-action="reset" data-user-id="${escapeHtml(user.id || '')}" ${isSelf ? 'disabled' : ''} title="Reset password for ${escapeHtml(user.name || user.email || '')}">
                  <i class="fa-solid fa-arrow-rotate-left"></i>
                </button>
                ${user.isBanned
                  ? `<button class="btn btn-primary icon-btn" type="button" data-action="enable" data-user-id="${escapeHtml(user.id || '')}" ${isSelf ? 'disabled' : ''} title="Enable the user ${escapeHtml(user.name || user.email || '')}"><i class="fa-solid fa-user-check"></i></button>`
                  : `<button class="btn btn-danger icon-btn" type="button" data-action="disable" data-user-id="${escapeHtml(user.id || '')}" ${isSelf ? 'disabled' : ''} title="Disable the user ${escapeHtml(user.name || user.email || '')}"><i class="fa-solid fa-user-xmark"></i></button>`
                }
              </div>
            </td>
          </tr>
        `;
    }).join('');
    status.textContent = `${filteredUsers.length} user${filteredUsers.length === 1 ? '' : 's'} shown.`;
}

async function resetUserPassword(user, button) {
    if (!user || !user.id) {
        showAlert('This user does not have a UUID available for password reset.', alertType.danger);
        return;
    }

    if (currentUser && user.id === currentUser.id) {
        showAlert('You cannot reset your own password from this screen.', alertType.danger);
        return;
    }
    console.log('Attempting to reset password for user:', user);
    if (!user?.email) {
        showAlert('No user selected for password reset.', alertType.danger);
        return;
    }
    button.disabled = true;
    button.textContent = 'Sending reset link…';

    try {
        const {
            error
        } = await supabaseClient.auth.resetPasswordForEmail(
            user.email, {
                redirectTo: FULL_REDIRECT_PAGE //'https://idoarborshoa.github.io/bookingpage/' // window.location.origin + '/index.html',
            }
        );

        if (error) throw error;

        showAlert(`Password reset link sent to ${user.email}!`, alertType.success);
    } catch (err) {
        showAlert(`Could not send reset email: ${err.message}`, alertType.danger);
    } finally {
        //button.disabled = false; //keep button disabled to prevent multiple clicks
        button.textContent = 'Reset link sent';
    }
}

async function disableUser_AdminsOnly(user) {
    const userId = user.id;
    if (!userId) {
        showAlert('This user does not have a UUID available for deletion.', alertType.danger);
        return;
    }

    if (currentUser && user.id === currentUser.id) {
        showAlert('You cannot disable your own account from this screen.', alertType.danger);
        return;
    }

    //if (!window.confirm(`Disable ${user.name || user.email || 'this user'}?`)) return;
    showConfirmationModal(`Disable ${user.name || user.email || 'this user'}?`, async () => {
        try {
            const {
                data,
                error
            } = await supabaseClient.functions.invoke('admin-ban-user', {
                body: {
                    user_id: user.id
                }
            });
            if (error) throw error;

            showAlert('User disabled successfully.', alertType.success);
            await loadAdminData();
        } catch (err) {
            showAlert(`Could not disable user: ${err.message}`, alertType.danger);
        }
    });
    return;

    /*
    try {
      const { data, error } = await supabaseClient.functions.invoke('admin-ban-user', {
        body: { user_id: user.id }
      });
      if (error) throw error;

      showAlert('User disabled successfully.', alertType.success);
      await loadAdminData();
    } catch (err) {
      showAlert(`Could not disable user: ${err.message}`, alertType.danger);
    }
      */
}

async function enableUser_AdminsOnly(user) {
    const userId = user.id;
    if (!userId) {
        showAlert('This user does not have a UUID available for enabling.', alertType.danger);
        return;
    }

    if (currentUser && user.id === currentUser.id) {
        showAlert('You cannot enable your own account from this screen.', alertType.danger);
        return;
    }

    //if (!window.confirm(`Enable ${user.name || user.email || 'this user'}?`)) return;
    showConfirmationModal(`Enable ${user.name || user.email || 'this user'}?`, async () => {
        try {
            const {
                data,
                error
            } = await supabaseClient.functions.invoke('admin-unban-user', {
                body: {
                    user_id: user.id
                }
            });
            if (error) throw error;

            showAlert('User enabled successfully.', alertType.success);
            await loadAdminData();
        } catch (err) {
            showAlert(`Could not enable user: ${err.message}`, alertType.danger);
        }
    });
    return;
    /*
    try {
      const { data, error } = await supabaseClient.functions.invoke('admin-unban-user', {
        body: { user_id: user.id }
      });
      if (error) throw error;

      showAlert('User enabled successfully.', alertType.success);
      await loadAdminData();
    } catch (err) {
      showAlert(`Could not enable user: ${err.message}`, alertType.danger);
    }
      */
}

async function loadAdminData() {
    const tableBody = document.getElementById('adminUserTableBody');
    const status = document.getElementById('adminUserStatus');
    if (!tableBody || !status) return;

    tableBody.innerHTML = '<tr><td colspan="5" class="text-muted">Loading users…</td></tr>';
    status.textContent = 'Loading users…';

    try {
        const {
            data,
            error
        } = await supabaseClient.rpc('admin_get_all_users');
        if (error) throw error;

        const normalizedUsers = (Array.isArray(data) ? data : []).map(normalizeAdminUser).filter(user => user.id || user.email || user.name);
        adminUsersCache = normalizedUsers;
        renderAdminUsers();

        if (!adminUsersCache.length) {
            status.textContent = 'No users available.';
        }
    } catch (err) {
        adminUsersCache = [];
        renderAdminUsers();
        status.textContent = `Unable to load users: ${err.message}`;
    }
}

// ── Auth ──────────────────────────────────────────────────────────────────

async function checkUserSession() {
    const {
        data: {
            session
        }
    } = await supabaseClient.auth.getSession();
    if (session) showBookingUI(session.user);
    else showLoginUI();
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await flipForm(true);
    const {
        data,
        error
    } = await supabaseClient.auth.signInWithPassword({
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
    });
    if (error) showAlert('Login failed: ' + error.message, alertType.danger);
    else showBookingUI(data.user);
    console.log('Login attempt result:', data, error);
    await flipForm(false);
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await flipForm(true);
    await supabaseClient.auth.signOut();
    showLoginUI();
    await flipForm(false);
});

document.getElementById('changePasswordBtn').addEventListener('click', () => {
    document.getElementById('changePasswordForm').reset();
    changePasswordModal.show();
});

document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    await flipForm(true);
    e.preventDefault();
    const newPassword = document.getElementById('changePasswordNew').value;
    const confirmPassword = document.getElementById('changePasswordConfirm').value;
    const submitBtn = e.submitter || document.querySelector('#changePasswordForm button[type="submit"]');

    if (newPassword !== confirmPassword) {
        showAlert('Passwords do not match.', alertType.danger);
        await flipForm(false);
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Updating…';

    const {
        data,
        error
    } = await supabaseClient.auth.updateUser({
        password: newPassword
    });

    if (error) {
        console.error('Password update failed:', error.message);
        showAlert(`Password update failed: ${error.message}`, alertType.danger);
    } else {
        console.log('Password updated successfully!');
        showAlert('Password updated successfully!', alertType.success);
        changePasswordModal.hide();
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Update Password';
    await flipForm(false);
});


// - confirmation helper
function showConfirmationModal(message, onConfirm) {
    const confirmationMessage = document.getElementById('confirmationMessage');
    const confirmationForm = document.getElementById('confirmationForm');
    const confirmationConfirmBtn = document.getElementById('confirmationConfirmBtn');

    confirmationMessage.textContent = message;

    const handleSubmit = (e) => {
        e.preventDefault();
        onConfirm();
        confirmationModal.hide();
        confirmationForm.removeEventListener('submit', handleSubmit);
    };

    confirmationForm.addEventListener('submit', handleSubmit);
    confirmationModal.show();
}
// ── Amenities ─────────────────────────────────────────────────────────────

function parseAmenitySchedule(scheduleValue) {
    if (!scheduleValue) return null;
    if (typeof scheduleValue === 'string') {
        const trimmed = scheduleValue.trim();
        if (!trimmed) return null;
        try {
            return JSON.parse(trimmed);
        } catch (err) {
            return null;
        }
    }
    return scheduleValue;
}

function serializeScheduleValue(scheduleValue) {
    if (!scheduleValue) return SAMPLE_SCHEDULE_JSON;
    if (typeof scheduleValue === 'string') return scheduleValue;
    return JSON.stringify(scheduleValue);
}

function getDayName(date) {
    return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
}

function parseTimeToMinutes(value) {
    const [hours, minutes] = String(value).split(':').map(Number);
    return hours * 60 + minutes;
}

function toTimeLabel(minutes) {
    const h = String(Math.floor(minutes / 60)).padStart(2, '0');
    const m = String(minutes % 60).padStart(2, '0');
    return `${h}:${m}`;
}

function normalizeBookingTime(value) {
    const minutes = parseTimeToMinutes(value);
    const roundedMinutes = Math.round(minutes / 30) * 30;
    const normalizedValue = toTimeLabel(roundedMinutes);
    return {
        value: normalizedValue,
        isHalfHour: minutes % 30 === 0
    };
}

function getTomorrowDateString() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getMaxBookingDateString() {
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + MAX_DAYS_SCHEDULE_INTO_FUTURE);
    const year = maxDate.getFullYear();
    const month = String(maxDate.getMonth() + 1).padStart(2, '0');
    const day = String(maxDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getMinBookingDateString() {
    const minDate = new Date();
    minDate.setDate(minDate.getDate()); //starting today
    const year = minDate.getFullYear();
    const month = String(minDate.getMonth() + 1).padStart(2, '0');
    const day = String(minDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;

}

function validateBookingDateRange(dateValue) {
    if (!dateValue) {
        return {
            isValid: false,
            message: 'Please choose a booking date.'
        };
    }

    const maxDate = getMaxBookingDateString();
    const minDate = getMinBookingDateString();
    if (dateValue < minDate) {
        return {
            isValid: false,
            message: `Booking date cannot be earlier than tomorrow (${minDate}).`
        };
    }

    if (dateValue > maxDate) {
        return {
            isValid: false,
            message: `Booking date cannot be more than 30 days ahead (${maxDate}).`
        };
    }

    return {
        isValid: true,
        message: ''
    };
}

function syncBookingDateConstraints() {
    const bookingDateInput = document.getElementById('bookingDate');
    if (!bookingDateInput) return;

    bookingDateInput.max = getMaxBookingDateString();
    bookingDateInput.min = getMinBookingDateString();
    const validation = validateBookingDateRange(bookingDateInput.value);
    bookingDateInput.setCustomValidity(validation.isValid ? '' : validation.message);
}

function updateBookButtonState() {
    const bookingDateInput = document.getElementById('bookingDate');
    const bookBtn = document.getElementById('bookBtn');
    if (!bookingDateInput || !bookBtn) return;

    const rangeValidation = validateBookingDateRange(bookingDateInput.value);
    bookBtn.disabled = !rangeValidation.isValid;
}

function formatTimeLabel(minutes) {
    const hours = Math.floor(minutes / 60) % 24;
    const suffix = hours >= 12 ? 'PM' : 'AM';
    let displayHour = hours % 12;
    if (displayHour === 0) displayHour = 12;
    const displayMinutes = minutes % 60;
    return `${displayHour}:${String(displayMinutes).padStart(2, '0')} ${suffix}`;
}

function buildTimeOptions() {
    const dateInput = document.getElementById('bookingDate');
    const timeSelect = document.getElementById('bookingTime');
    const durationMinutes = Number(document.getElementById('bookingDuration').value);
    const selectedOption = document.getElementById('amenitySelect').selectedOptions[0];
    const scheduleValue = selectedOption ? selectedOption.dataset.schedule : SAMPLE_SCHEDULE_JSON;
    const previousValue = timeSelect.value;

    timeSelect.innerHTML = '';

    if (!dateInput.value) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Select a date first';
        timeSelect.appendChild(opt);
        return;
    }

    const selectedDate = new Date(`${dateInput.value}T12:00:00`);
    const windows = getAllowedWindowsForDate(scheduleValue, selectedDate);
    const effectiveWindows = windows === null ? [{
        start: '00:00',
        end: '23:30'
    }] : windows;

    if (!effectiveWindows.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No available times';
        timeSelect.appendChild(opt);
        return;
    }

    const validSlots = [];
    effectiveWindows.forEach(window => {
        const startMinutes = parseTimeToMinutes(window.start);
        const endMinutes = parseTimeToMinutes(window.end);
        for (let minutes = startMinutes; minutes + durationMinutes <= endMinutes; minutes += 30) {
            validSlots.push(minutes);
        }
    });

    const uniqueSlots = [...new Set(validSlots)].sort((a, b) => a - b);
    if (!uniqueSlots.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No available times for selected duration';
        timeSelect.appendChild(opt);
        return;
    }

    uniqueSlots.forEach(minutes => {
        const opt = document.createElement('option');
        opt.value = toTimeLabel(minutes);
        opt.textContent = formatTimeLabel(minutes);
        timeSelect.appendChild(opt);
    });

    const nextValue = previousValue && uniqueSlots.includes(parseTimeToMinutes(previousValue)) ?
        previousValue :
        toTimeLabel(uniqueSlots[0]);
    timeSelect.value = nextValue;
}

function getAllowedWindowsForDate(scheduleValue, selectedDate) {
    const schedule = parseAmenitySchedule(scheduleValue);
    if (!schedule) return null;

    const dateKey = selectedDate.toISOString().slice(0, 10);
    if (Array.isArray(schedule.blocked_dates) && schedule.blocked_dates.includes(dateKey)) {
        return [];
    }

    const dayName = getDayName(selectedDate);
    const dayWindows = schedule[dayName];
    if (Array.isArray(dayWindows)) {
        return dayWindows;
    }

    if (Array.isArray(schedule.blocked_days) && schedule.blocked_days.includes(dayName)) {
        return [];
    }

    return null;
}

function validateBookingTime(selectedDate, selectedTime, durationMinutes, scheduleValue) {
    const windows = getAllowedWindowsForDate(scheduleValue, selectedDate);
    if (windows === null) {
        return {
            isValid: true,
            message: 'Using default availability.',
            windows: []
        };
    }
    if (!windows.length) {
        return {
            isValid: false,
            message: 'This amenity is not available on the selected day.',
            windows: []
        };
    }

    if (durationMinutes > 120) {
        return {
            isValid: false,
            message: 'Maximum booking duration is 2 hours.',
            windows
        };
    }

    const startMinutes = parseTimeToMinutes(selectedTime);
    const endMinutes = startMinutes + durationMinutes;
    const isAllowed = windows.some(window => {
        const start = parseTimeToMinutes(window.start);
        const end = parseTimeToMinutes(window.end);
        return startMinutes >= start && endMinutes <= end && durationMinutes % 30 === 0;
    });

    if (!isAllowed) {
        const labels = windows.map(w => `${w.start}–${w.end}`).join(', ');
        return {
            isValid: false,
            message: `Booking must stay within the allowed window(s): ${labels}`,
            windows
        };
    }

    return {
        isValid: true,
        message: `Booking is within the allowed window(s).`,
        windows
    };
}

function updateScheduleHint() {
    const dateValue = document.getElementById('bookingDate').value;
    const selectedOption = document.getElementById('amenitySelect').selectedOptions[0];
    const scheduleValue = selectedOption ? selectedOption.dataset.schedule : SAMPLE_SCHEDULE_JSON;
    const hint = document.getElementById('scheduleHint');

    if (!dateValue) {
        hint.textContent = 'Choose a date to view the amenity schedule.';
        return;
    }

    const selectedDate = new Date(`${dateValue}T12:00:00`);
    const windows = getAllowedWindowsForDate(scheduleValue, selectedDate);
    if (windows === null) {
        hint.textContent = 'No specific schedule found for this amenity. Default booking is allowed.';
        return;
    }

    if (!windows.length) {
        hint.textContent = 'No booking windows are available on this day.';
        return;
    }

    const labels = windows.map(w => `${w.start}–${w.end}`).join(' | ');
    hint.textContent = `Allowed windows: ${labels}`;
}

function refreshBookingAvailability() {
    syncBookingDateConstraints();
    updateScheduleHint();
    buildTimeOptions();
    updateBookButtonState();
}

async function loadAmenities() {
    const {
        data
    } = await supabaseClient.from('amenities').select('*').order('name');
    const sel = document.getElementById('amenitySelect');
    const legend = document.getElementById('legendList');
    sel.innerHTML = '';
    legend.innerHTML = '';

    if (data && data.length > 0) {
        data.forEach((item, i) => {
            const color = COLORS[i % COLORS.length];
            amenityColors[item.amenity_id] = {
                color,
                name: item.name
            };

            const opt = document.createElement('option');
            opt.value = item.amenity_id;
            opt.textContent = item.name;
            opt.dataset.schedule = serializeScheduleValue(item.schedule);
            sel.appendChild(opt);

            const row = document.createElement('div');
            row.className = 'd-flex align-items-center gap-2 mb-1';
            row.innerHTML = `<div style="width:14px;height:14px;border-radius:3px;background:${color};flex-shrink:0"></div><span class="small">${item.name}</span>`;
            legend.appendChild(row);
        });
    } else {
        sel.innerHTML = '<option value="">No amenities available</option>';
    }

    refreshBookingAvailability();
}

// ── Calendar ──────────────────────────────────────────────────────────────

async function fetchBookings() {
    const {
        data,
        error
    } = await supabaseClient
        .from('bookings')
        .select('booking_id, amenity_id, booked_time, user_id, amenities(name),end_time,public_profiles(name, unit_number)');

    if (error) {
        console.error('Bookings fetch error:', error);
        return [];
    }
    const allBookings = data || [];
    const visibleBookings = (showOnlyMyBookings && currentUser) ?
        allBookings.filter(b => b.user_id === currentUser.id) :
        allBookings;

    return visibleBookings.map(b => {
        const info = amenityColors[b.amenity_id] || {};
        const color = info.color || '#6c757d';
        const amenityName = (b.amenities && b.amenities.name) || info.name || 'Booking';
        const isMine = currentUser && b.user_id === currentUser.id;
        const start = new Date(b.booked_time);
        const end = new Date(b.end_time);
        const userName = (b.public_profiles && b.public_profiles.name) || 'Unknown User';
        const unitNumber = (b.public_profiles && b.public_profiles.unit_number) || 'N/A';

        return {
            id: b.booking_id,
            title: amenityName,
            start,
            end,
            backgroundColor: color,
            borderColor: isMine ? '#198754' : color,
            textColor: '#fff',
            classNames: isMine ? ['my-booking'] : [],
            extendedProps: {
                amenityName,
                bookedTime: b.booked_time,
                endTime: b.end_time,
                isMine,
                userName,
                unitNumber
            }
        };
    });
}

function syncCalendarControls() {
    const datePicker = document.getElementById('calendarDatePicker');
    const viewSelect = document.getElementById('calendarViewSelect');
    if (!calendar || !datePicker || !viewSelect) return;

    const currentDate = calendar.getDate();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    datePicker.value = `${year}-${month}-${day}`;
    viewSelect.value = calendar.view.type;
}

function initCalendar() {
    if (calendar) calendar.destroy();
    bookingModal = new bootstrap.Modal(document.getElementById('bookingModal'));

    calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
        initialView: window.innerWidth < 768 ? 'rolling30' : 'dayGridMonth',
        initialDate: new Date(),
        height: '100%',
        views: {
            rolling30: {
                type: 'list',
                duration: {
                    days: 30
                },
                buttonText: 'Next 30 days'
            }
        },
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,rolling30'
        },
        events: fetchBookings,
        datesSet: syncCalendarControls,
        viewDidMount: syncCalendarControls,
        eventClick(info) {
            const {
                amenityName,
                bookedTime,
                endTime,
                isMine
            } = info.event.extendedProps;
            const dt = new Date(bookedTime);
            const dateStr = dt.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            const timeStr = dt.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
            });

            const et = new Date(endTime);
            const endTimeStr = et.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
            });

            document.getElementById('modalTitle').textContent = amenityName;
            document.getElementById('modalBody').innerHTML = `
            <div class="my-3">${isMine ? '<span class="badge bg-success">My Booking</span>' : `<span class="badge bg-secondary">Booked by ${info.event.extendedProps.userName} (${info.event.extendedProps.unitNumber})</span>`}</div>
            <p class="my-2"><strong><i class="fa-solid fa-calendar"></i> Date:</strong> ${dateStr}</p>
            <p class="my-2"><strong><i class="fa-solid fa-clock"></i> Start Time:</strong> ${timeStr}</p>
            <p class="my-2"><strong><i class="fa-solid fa-clock"></i> End Time:</strong> ${endTimeStr}</p>
          `;


            const allowCancel = (isMine || isSuperAdmin) && dt > new Date();

            const cancelBtn = document.getElementById('cancelBookingBtn');
            if (allowCancel) {
                cancelBtn.classList.remove('d-none');
                activeEventId = info.event.id;
            } else {
                cancelBtn.classList.add('d-none');
                activeEventId = null;
            }
            bookingModal.show();
        }
    });

    calendar.render();
    syncCalendarControls();
}

document.getElementById('calendarDatePicker').addEventListener('change', () => {
    if (!calendar) return;
    const selectedDate = new Date(`${document.getElementById('calendarDatePicker').value}T12:00:00`);
    if (isNaN(selectedDate.getTime())) return;
    if (selectedDate.getFullYear() < 2000 || selectedDate.getFullYear() > 3000) return;
    calendar.gotoDate(selectedDate);
});

document.getElementById('calendarViewSelect').addEventListener('change', (e) => {
    if (!calendar) return;
    calendar.changeView(e.target.value);
    syncCalendarControls();
});

document.getElementById('myBookingsOnlySwitch').addEventListener('change', (e) => {
    showOnlyMyBookings = e.target.checked;
    if (calendar) calendar.refetchEvents();
});

document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.dataset.view === 'admin' && !isSuperAdmin) return;
        setActiveView(btn.dataset.view);
        if (btn.dataset.view === 'admin') {
            loadAdminData();
        }
    });
});

// ── Cancel booking ────────────────────────────────────────────────────────

document.getElementById('cancelBookingBtn').addEventListener('click', async () => {
    if (!activeEventId) return;
    await flipForm(true);
    const btn = document.getElementById('cancelBookingBtn');
    btn.disabled = true;
    btn.textContent = 'Cancelling…';

    const {
        error
    } = await supabaseClient.rpc('cancel_booking', {
        p_booking_id: activeEventId
    });

    btn.disabled = false;
    btn.textContent = 'Cancel Booking';

    console.log('Cancel booking result:', error);

    if (error) {
        showAlert('Could not cancel booking: ' + error.message, alertType.danger);
    } else {
        bookingModal.hide();
        calendar.refetchEvents();
        showAlert('Booking cancelled successfully.', alertType.success);
    }
    await flipForm(false);
});

// ── New booking form ──────────────────────────────────────────────────────

document.getElementById('amenitySelect').addEventListener('change', refreshBookingAvailability);
document.getElementById('bookingDate').addEventListener('change', refreshBookingAvailability);
document.getElementById('bookingDuration').addEventListener('change', refreshBookingAvailability);
document.getElementById('adminUserSearch').addEventListener('input', renderAdminUsers);

document.getElementById('adminUserTableBody').addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    const userId = button.getAttribute('data-user-id');
    const user = adminUsersCache.find(item => item.id === userId);
    if (!user) return;
    if (action === 'reset') {
        await resetUserPassword(user, button);
    } else if (action === 'delete') {
        await deleteAdminUser(user);
        //TODO: options enable / disable user instead of delete
    } else if (action === 'enable') {
        await enableUser_AdminsOnly(user);
    } else if (action === 'disable') {
        await disableUser_AdminsOnly(user);
    }
});

document.getElementById('openAddUserModalBtn').addEventListener('click', () => {
    adminUserModal.show();
});

document.getElementById('addUserForm').addEventListener('submit', async (e) => {
    await flipForm(true);
    e.preventDefault();
    const email = document.getElementById('newUserEmail').value.trim();
    const name = document.getElementById('newUserName').value.trim();
    const unitNumber = document.getElementById('newUserUnitNumber').value;
    const {
        data: {
            session
        }
    } = await supabaseClient.auth.getSession();

    const createBtn = e.submitter || document.querySelector('#addUserForm button[type="submit"]');
    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';

    try {
        const {
            data,
            error
        } = await supabaseClient.functions.invoke('admin-create-user', {
            body: {
                email: email,
                name: name,
                unit_number: unitNumber,
                is_superadmin: false,
                redirectTo: FULL_REDIRECT_PAGE // 'https://idoarborshoa.github.io/bookingpage/' // window.location.origin + '/index.html'
            }
        });

        if (error) {
            showAlert('Failed to create user: ' + error.message, alertType.danger);
        }


        if (error) throw error;
        showAlert(`User created successfully.`, alertType.success);
        adminUserModal.hide();
        document.getElementById('addUserForm').reset();
        await loadAdminData();
    } catch (err) {
        showAlert(`Could not create user: ${err.message}`, alertType.danger);
    } finally {
        createBtn.disabled = false;
        createBtn.textContent = 'Create User';
        await flipForm(false);
    }
});

document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    await flipForm(true);
    e.preventDefault();
    const amenityId = document.getElementById('amenitySelect').value;
    const date = document.getElementById('bookingDate').value;
    const timeInput = document.getElementById('bookingTime');
    const time = timeInput.value;
    const durationMinutes = Number(document.getElementById('bookingDuration').value);

    const rangeValidation = validateBookingDateRange(date);
    if (!rangeValidation.isValid) {
        document.getElementById('bookingDate').reportValidity();
        showAlert(rangeValidation.message, alertType.danger);
        updateBookButtonState();
        await flipForm(false);
        return;
    }

    const selectedOption = document.getElementById('amenitySelect').selectedOptions[0];
    const scheduleValue = selectedOption ? selectedOption.dataset.schedule : SAMPLE_SCHEDULE_JSON;
    const validation = validateBookingTime(new Date(`${date}T12:00:00`), time, durationMinutes, scheduleValue);
    if (!validation.isValid) {
        showAlert(validation.message, alertType.danger);
        await flipForm(false);
        return;
    }

    const isoTimestamp = new Date(`${date}T${time}:00`).toISOString();

    const bookBtn = document.getElementById('bookBtn');
    bookBtn.disabled = true;
    bookBtn.textContent = 'Checking…';

    const {
        data: bookingId,
        error
    } = await supabaseClient.rpc('book_amenity', {
        p_amenity_id: amenityId,
        p_booked_time: isoTimestamp,
        p_end_time: new Date(new Date(`${date}T${time}:00`).getTime() + durationMinutes * 60000).toISOString()
    });
    if (error) {
        console.log('Error Code:', error.code);
        console.log('Error Message:', error.message);
    }


    showAlert(error ? error.message : `Booking confirmed!`, error ? alertType.danger : alertType.success);
    bookBtn.disabled = false;
    bookBtn.innerHTML = '<i class="fa-solid fa-calendar-check"></i> Reserve Amenity <i class="fa-solid fa-calendar-check"></i>';
    if (!error && calendar) calendar.refetchEvents();
    await flipForm(false);
});

function updateThemeToggleLabel() {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    btn.innerHTML = g_isDarkMode ?
        '<i class="fa-solid fa-sun" aria-hidden="true"></i>' :
        '<i class="fa-solid fa-moon" aria-hidden="true"></i>';
    const nextModeLabel = g_isDarkMode ? 'Switch to light theme' : 'Switch to dark theme';
    btn.setAttribute('aria-label', nextModeLabel);
    btn.setAttribute('title', nextModeLabel);
}

document.getElementById('themeToggleBtn').addEventListener('click', () => {
    g_htmlElement.setAttribute('data-bs-theme', g_isDarkMode ? 'light' : 'dark');
    localStorage.setItem(myThemeStorageName, g_isDarkMode ? 'light' : 'dark');
    g_isDarkMode = !g_isDarkMode;
    updateThemeToggleLabel();
});

adminUserModal = new bootstrap.Modal(document.getElementById('addUserModal'));
//resetPasswordModal = new bootstrap.Modal(document.getElementById('resetPasswordModal'));
changePasswordModal = new bootstrap.Modal(document.getElementById('changePasswordModal'));
confirmationModal = new bootstrap.Modal(document.getElementById('confirmationModal'));
document.getElementById('bookingDate').value = getTomorrowDateString();
syncBookingDateConstraints();

updateThemeToggleLabel();
refreshBookingAvailability();
checkUserSession();