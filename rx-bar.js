'use strict';
/* ── RxBar — shared auth + patient widget for all RxTools calculators ── */

const RXB_PORTAL = 'https://salemh-glitch.github.io/pharmacy-portal/';
const RXB_SB_URL = 'https://nqxtbjrpddzgkfsdsywg.supabase.co';
const RXB_SB_KEY = 'sb_publishable_OZbSJoNrKxXuOrWdkg_icA_ydRvwYGV';

class RxBar {
  constructor(appName, onPatientChange) {
    this.appName = appName;
    this.onPatientChange = onPatientChange || function() {};
    this.session = null;
    this.profile = null;
    this.selectedPatient = null;
    this._sb = window.supabase.createClient(RXB_SB_URL, RXB_SB_KEY);
    this._init();
  }

  async _init() {
    // Handle cross-origin SSO: portal passes tokens in URL hash
    const hash = window.location.hash.slice(1);
    if (hash.includes('access_token=')) {
      const p = new URLSearchParams(hash);
      const at = p.get('access_token');
      const rt = p.get('refresh_token');
      if (at && rt) {
        await this._sb.auth.setSession({ access_token: at, refresh_token: rt });
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }

    const { data: { session } } = await this._sb.auth.getSession();
    if (!session) {
      window.location.href = RXB_PORTAL + 'index.html?returnTo=' + encodeURIComponent(window.location.href);
      return;
    }
    this.session = session;
    const { data: profile } = await this._sb.from('profiles').select('full_name').eq('id', session.user.id).single();
    this.profile = profile;
    this._inject();
    this._bind();
    document.dispatchEvent(new CustomEvent('rxb:ready', { detail: { session, profile } }));
  }

  _inject() {
    const bar = document.createElement('div');
    bar.id = 'rxb-bar';
    bar.innerHTML = `
      <div class="rxb-inner">
        <a class="rxb-portal-link" href="${RXB_PORTAL}dashboard.html">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 7h2v7h4v-4h2v4h4V7h2L8 1z"/></svg>
          RxTools
        </a>
        <div class="rxb-divider"></div>
        <div class="rxb-patient-zone">
          <div class="rxb-search-wrap" id="rxb-search-wrap">
            <input class="rxb-search-input" id="rxb-search" placeholder="Search patient by name or ID…" autocomplete="off" type="text">
            <div class="rxb-dropdown" id="rxb-dropdown" style="display:none"></div>
          </div>
          <div class="rxb-selected" id="rxb-selected" style="display:none"></div>
          <button class="rxb-new-btn" id="rxb-new-btn" type="button">+ New Patient</button>
        </div>
        <div class="rxb-user">
          <span class="rxb-username">${this._esc(this.profile?.full_name || this.session.user.email)}</span>
          <button class="rxb-signout" id="rxb-signout" type="button">Sign Out</button>
        </div>
      </div>`;
    document.body.insertBefore(bar, document.body.firstChild);
  }

  _bind() {
    document.getElementById('rxb-signout')?.addEventListener('click', async () => {
      await this._sb.auth.signOut();
      window.location.href = RXB_PORTAL + 'index.html';
    });

    let timer;
    document.getElementById('rxb-search')?.addEventListener('input', e => {
      clearTimeout(timer);
      const q = e.target.value.trim();
      if (q.length < 2) { this._hideDropdown(); return; }
      timer = setTimeout(() => this._search(q), 280);
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#rxb-search-wrap')) this._hideDropdown();
    });

    document.getElementById('rxb-new-btn')?.addEventListener('click', () => this._showModal());
  }

  async _search(query) {
    let q = this._sb.from('patients')
      .select('id, patient_id, first_name, last_name, weight_kg, height_cm, scr_mg_dl, crcl_ml_min, date_of_birth, gender, allergies')
      .limit(8);

    if (/^pt-/i.test(query)) {
      q = q.ilike('patient_id', `${query}%`);
    } else {
      q = q.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`);
    }

    const { data } = await q;
    this._showDropdown(data || []);
  }

  _showDropdown(patients) {
    const dd = document.getElementById('rxb-dropdown');
    if (!dd) return;
    if (!patients.length) {
      dd.innerHTML = '<div class="rxb-dd-empty">No patients found</div>';
    } else {
      dd.innerHTML = patients.map(p => `
        <div class="rxb-dd-item" data-json='${this._safeJson(p)}'>
          <span class="rxb-dd-pid">${p.patient_id}</span>
          <span class="rxb-dd-name">${this._esc(p.last_name)}, ${this._esc(p.first_name)}</span>
          <span class="rxb-dd-meta">${p.weight_kg ? p.weight_kg + 'kg' : ''} ${p.gender || ''}</span>
        </div>`).join('');
      dd.querySelectorAll('.rxb-dd-item').forEach(item => {
        item.addEventListener('click', () => {
          try {
            const p = JSON.parse(item.dataset.json);
            this._select(p);
          } catch { /* ignore */ }
        });
      });
    }
    dd.style.display = 'block';
  }

  _hideDropdown() {
    const dd = document.getElementById('rxb-dropdown');
    if (dd) dd.style.display = 'none';
  }

  _select(patient) {
    this.selectedPatient = patient;
    const wrap = document.getElementById('rxb-search-wrap');
    const sel  = document.getElementById('rxb-selected');
    if (wrap) wrap.style.display = 'none';
    if (sel) {
      sel.style.display = 'flex';
      const meta = [
        patient.weight_kg != null ? patient.weight_kg + ' kg' : null,
        patient.scr_mg_dl != null ? 'SCr ' + patient.scr_mg_dl : null,
        patient.crcl_ml_min != null ? 'CrCl ' + patient.crcl_ml_min : null,
      ].filter(Boolean).join(' · ');
      sel.innerHTML = `
        <span class="rxb-sel-pid">${patient.patient_id}</span>
        <span class="rxb-sel-name">${this._esc(patient.first_name)} ${this._esc(patient.last_name)}</span>
        ${meta ? `<span class="rxb-sel-meta">${meta}</span>` : ''}
        <button class="rxb-clear-btn" id="rxb-clear" type="button">&#x2715;</button>`;
      document.getElementById('rxb-clear')?.addEventListener('click', () => this._clear());
    }
    this._hideDropdown();
    this.onPatientChange(patient);

    // Fire custom event so calculators can pre-fill fields
    document.dispatchEvent(new CustomEvent('rxb:patient-selected', { detail: patient }));
  }

  _clear() {
    this.selectedPatient = null;
    const wrap = document.getElementById('rxb-search-wrap');
    const sel  = document.getElementById('rxb-selected');
    if (sel)  { sel.style.display = 'none'; sel.innerHTML = ''; }
    if (wrap) { wrap.style.display = ''; }
    const inp = document.getElementById('rxb-search');
    if (inp) inp.value = '';
    this.onPatientChange(null);
    document.dispatchEvent(new CustomEvent('rxb:patient-cleared'));
  }

  // Call this from calculator JS after a successful calculation
  async saveCalculation(type, inputs, result) {
    if (!this.selectedPatient || !this.session) return;
    try {
      await this._sb.from('calculations').insert({
        patient_id: this.selectedPatient.id,
        user_id:    this.session.user.id,
        app:        this.appName,
        type,
        inputs,
        result,
      });
    } catch (e) {
      console.warn('RxBar: failed to save calculation', e);
    }
  }

  _showModal(prefill) {
    const p = prefill || {};
    const overlay = document.createElement('div');
    overlay.className = 'rxb-modal-overlay';
    overlay.innerHTML = `
      <div class="rxb-modal-card">
        <div class="rxb-modal-header">
          <h3>New Patient</h3>
          <button class="rxb-modal-close" id="rxb-mc-close" type="button">&#x2715;</button>
        </div>
        <div class="rxb-modal-body">
          <div id="rxb-modal-error" class="rxb-modal-error" style="display:none"></div>
          <div class="rxb-modal-grid">
            <div class="rxb-modal-field">
              <label for="rxb-fn">First Name *</label>
              <input type="text" id="rxb-fn" value="${this._esc(p.first_name||'')}">
            </div>
            <div class="rxb-modal-field">
              <label for="rxb-ln">Last Name *</label>
              <input type="text" id="rxb-ln" value="${this._esc(p.last_name||'')}">
            </div>
            <div class="rxb-modal-field">
              <label for="rxb-dob">Date of Birth</label>
              <input type="date" id="rxb-dob" value="${p.date_of_birth||''}">
            </div>
            <div class="rxb-modal-field">
              <label for="rxb-gender">Gender</label>
              <select id="rxb-gender">
                <option value="">Select…</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="rxb-modal-field">
              <label for="rxb-wt">Weight (kg)</label>
              <input type="number" id="rxb-wt" value="${p.weight_kg||''}" step="0.1" min="0">
            </div>
            <div class="rxb-modal-field">
              <label for="rxb-ht">Height (cm)</label>
              <input type="number" id="rxb-ht" value="${p.height_cm||''}" step="0.1" min="0">
            </div>
            <div class="rxb-modal-field">
              <label for="rxb-scr">Serum Creatinine (mg/dL)</label>
              <input type="number" id="rxb-scr" value="${p.scr_mg_dl||''}" step="0.01" min="0">
            </div>
            <div class="rxb-modal-field">
              <label for="rxb-crcl">CrCl (mL/min)</label>
              <input type="number" id="rxb-crcl" value="${p.crcl_ml_min||''}" step="0.1" min="0" placeholder="Auto-calculated">
              <span class="rxb-modal-hint">Cockcroft-Gault; auto-fills when SCr + weight + DOB + gender are set</span>
            </div>
            <div class="rxb-modal-field rxb-modal-full">
              <label for="rxb-allergies">Allergies</label>
              <input type="text" id="rxb-allergies" value="${this._esc(p.allergies||'')}" placeholder="e.g. Penicillin, Sulfa">
            </div>
            <div class="rxb-modal-field">
              <label for="rxb-mrn">Hospital MRN (optional)</label>
              <input type="text" id="rxb-mrn" value="${this._esc(p.mrn||'')}">
            </div>
            <div class="rxb-modal-field rxb-modal-full">
              <label for="rxb-notes">Notes</label>
              <textarea id="rxb-notes" rows="2">${this._esc(p.notes||'')}</textarea>
            </div>
          </div>
        </div>
        <div class="rxb-modal-footer">
          <button class="rxb-btn-cancel" id="rxb-mc-cancel" type="button">Cancel</button>
          <button class="rxb-btn-save" id="rxb-mc-save" type="button">Create Patient</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
    document.getElementById('rxb-mc-close')?.addEventListener('click', close);
    document.getElementById('rxb-mc-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Auto-calc CrCl
    const autoCalc = () => {
      const dob = document.getElementById('rxb-dob').value;
      const wt  = parseFloat(document.getElementById('rxb-wt').value);
      const scr = parseFloat(document.getElementById('rxb-scr').value);
      const sex = document.getElementById('rxb-gender').value;
      if (!dob || !wt || !scr || !sex) return;
      const age = Math.floor((Date.now() - new Date(dob + 'T00:00:00').getTime()) / (365.25*24*3600*1000));
      if (age <= 0 || scr <= 0) return;
      let crcl = ((140 - age) * wt) / (72 * scr);
      if (sex === 'Female') crcl *= 0.85;
      document.getElementById('rxb-crcl').value = Math.max(0, Math.round(crcl * 10) / 10);
    };
    ['rxb-dob','rxb-wt','rxb-scr','rxb-gender'].forEach(id =>
      document.getElementById(id)?.addEventListener('change', autoCalc)
    );

    document.getElementById('rxb-mc-save')?.addEventListener('click', async () => {
      const fn = document.getElementById('rxb-fn').value.trim();
      const ln = document.getElementById('rxb-ln').value.trim();
      const errEl = document.getElementById('rxb-modal-error');

      if (!fn || !ln) {
        errEl.textContent = 'First name and last name are required.';
        errEl.style.display = 'block';
        return;
      }

      const saveBtn = document.getElementById('rxb-mc-save');
      saveBtn.textContent = 'Creating…';
      saveBtn.disabled = true;

      const payload = {
        first_name:    fn,
        last_name:     ln,
        date_of_birth: document.getElementById('rxb-dob').value      || null,
        gender:        document.getElementById('rxb-gender').value    || null,
        weight_kg:     parseFloat(document.getElementById('rxb-wt').value)    || null,
        height_cm:     parseFloat(document.getElementById('rxb-ht').value)    || null,
        scr_mg_dl:     parseFloat(document.getElementById('rxb-scr').value)   || null,
        crcl_ml_min:   parseFloat(document.getElementById('rxb-crcl').value)  || null,
        allergies:     document.getElementById('rxb-allergies').value.trim()  || null,
        mrn:           document.getElementById('rxb-mrn').value.trim()        || null,
        notes:         document.getElementById('rxb-notes').value.trim()      || null,
        created_by:    this.session.user.id,
      };

      const { data: patient, error } = await this._sb
        .from('patients').insert(payload).select().single();

      if (error) {
        errEl.textContent = error.message;
        errEl.style.display = 'block';
        saveBtn.textContent = 'Create Patient';
        saveBtn.disabled = false;
        return;
      }

      close();
      this._select(patient);
    });
  }

  _esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  _safeJson(obj) {
    return JSON.stringify(obj).replace(/'/g,'&apos;');
  }
}

window.RxBar = RxBar;
