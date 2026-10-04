import {
  apiRequest,
  formatMoney,
  getStoredUser,
  getToken,
  logoutToLogin,
  setNotice,
} from './api.js';

const tbody = document.querySelector('#pending-payments');
const notice = document.querySelector('#admin-notice');
const count = document.querySelector('#payment-count');

function cell(row, text, className = 'px-4 py-4 text-slate-300') {
  const td = document.createElement('td');
  td.className = className;
  td.textContent = text ?? '—';
  row.append(td);
  return td;
}

function renderPayments(payments) {
  tbody.replaceChildren();
  count.textContent = `${payments.length} pago${payments.length === 1 ? '' : 's'} pendiente${payments.length === 1 ? '' : 's'}`;
  if (!payments.length) {
    const row = document.createElement('tr');
    const empty = cell(row, 'No hay pagos manuales pendientes.', 'px-5 py-12 text-center text-slate-500');
    empty.colSpan = 7;
    tbody.append(row);
    return;
  }

  for (const payment of payments) {
    const row = document.createElement('tr');
    const customer = payment.userId;
    const customerCell = document.createElement('td');
    customerCell.className = 'px-5 py-4';
    const name = document.createElement('p');
    name.className = 'font-medium text-white';
    name.textContent = customer?.name || 'Cuenta no disponible';
    const email = document.createElement('p');
    email.className = 'mt-1 text-xs text-slate-500';
    email.textContent = customer?.email || '';
    const phone = document.createElement('p');
    phone.className = 'mt-1 text-xs text-slate-500';
    phone.textContent = customer?.phone || '';
    customerCell.append(name, email, phone);
    row.append(customerCell);

    cell(row, payment.method === 'pago_movil' ? 'Pago Móvil' : 'Facebank / Pipol Pay');
    cell(row, payment.reference, 'px-4 py-4 font-mono text-xs text-slate-300');
    cell(row, `${payment.plan.toUpperCase()} · ${formatMoney(payment.amount, payment.currency)}`);

    const proofCell = document.createElement('td');
    proofCell.className = 'px-4 py-4';
    if (payment.proofUrl) {
      const link = document.createElement('a');
      link.href = payment.proofUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.referrerPolicy = 'no-referrer';
      link.className = 'text-mint hover:text-white';
      link.textContent = 'Ver comprobante ↗';
      proofCell.append(link);
    } else {
      proofCell.textContent = 'Sin enlace';
      proofCell.className += ' text-slate-500';
    }
    row.append(proofCell);
    const date = new Date(payment.createdAt);
    cell(row, Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString(), 'px-4 py-4 text-xs text-slate-500');

    const actions = document.createElement('td');
    actions.className = 'px-5 py-4';
    const actionWrap = document.createElement('div');
    actionWrap.className = 'flex justify-end gap-2';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'rounded-lg bg-mint px-3 py-2 text-xs font-semibold text-ink hover:bg-white disabled:opacity-50';
    approve.textContent = 'Aprobar';
    approve.addEventListener('click', () => void reviewPayment(payment._id, 'approve', approve, reject));
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'rounded-lg border border-rose-300/20 px-3 py-2 text-xs text-rose-200 hover:bg-rose-300/10 disabled:opacity-50';
    reject.textContent = 'Rechazar';
    reject.addEventListener('click', () => void reviewPayment(payment._id, 'reject', approve, reject));
    actionWrap.append(approve, reject);
    actions.append(actionWrap);
    row.append(actions);
    tbody.append(row);
  }
}

async function loadPayments() {
  try {
    const result = await apiRequest('/payments/admin/pending');
    renderPayments(result.payments || []);
    setNotice(notice, '');
  } catch (error) {
    count.textContent = 'No se pudieron cargar los pagos.';
    setNotice(notice, error.message, 'error');
  }
}

async function reviewPayment(paymentId, action, approveButton, rejectButton) {
  const actionText = action === 'approve' ? 'aprobar' : 'rechazar';
  if (!confirm(`¿Confirmas que deseas ${actionText} este pago?`)) return;
  approveButton.disabled = true;
  rejectButton.disabled = true;
  try {
    await apiRequest(`/payments/admin/${encodeURIComponent(paymentId)}/review`, {
      method: 'POST',
      body: { action },
    });
    setNotice(notice, `Pago ${action === 'approve' ? 'aprobado' : 'rechazado'} correctamente.`, 'success');
    await loadPayments();
  } catch (error) {
    setNotice(notice, error.message, 'error');
    approveButton.disabled = false;
    rejectButton.disabled = false;
  }
}

document.querySelector('#refresh').addEventListener('click', () => void loadPayments());
document.querySelector('#logout').addEventListener('click', logoutToLogin);

if (!getToken()) {
  location.href = `/login.html?next=${encodeURIComponent('/admin.html')}`;
} else {
  try {
    const { user } = await apiRequest('/auth/me');
    if (user.role !== 'admin') {
      location.href = '/dashboard.html';
    } else {
      const cached = getStoredUser();
      if (cached) localStorage.setItem('waGatewayUser', JSON.stringify(user));
      await loadPayments();
    }
  } catch (error) {
    setNotice(notice, error.message, 'error');
  }
}
