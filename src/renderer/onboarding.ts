import { $ } from './dom.js';

/** First-run wizard: link GitHub, create the verification code, optionally enroll the face. */
export function runOnboarding(): Promise<void> {
  const api = window.devpanel;
  const web = api.platform === 'web';
  const wizard = $('wizard');
  const steps = [...document.querySelectorAll('#wz-steps i')];
  let login = '';
  let avatar = '';
  let faceDone = false;

  const go = (n: number) => {
    document.querySelectorAll('.wz-step').forEach((s) => s.classList.toggle('active', s.id === `wz-${n}`));
    steps.forEach((s, i) => s.classList.toggle('on', i < Math.min(n, 3)));
  };

  wizard.classList.remove('hidden');
  go(1);

  return new Promise<void>((resolve) => {
    // ---- step 1: GitHub ----
    const userInput = $<HTMLInputElement>('wz-user');
    const errUser = $('wz-user-err');
    const link = async () => {
      const btn = $<HTMLButtonElement>('wz-user-btn');
      btn.disabled = true;
      errUser.textContent = '';
      try {
        const p = await api.github.lookup(userInput.value);
        login = p.login;
        avatar = p.avatar;
        $<HTMLImageElement>('wz-avatar').src = p.avatar;
        $('wz-name').textContent = p.name ?? p.login;
        $('wz-login').textContent = `@${p.login}`;
        $('wz-profile').classList.remove('hidden');
        $<HTMLButtonElement>('wz-1-next').disabled = false;
      } catch (e) {
        login = '';
        $('wz-profile').classList.add('hidden');
        $<HTMLButtonElement>('wz-1-next').disabled = true;
        errUser.textContent = (e as Error).message;
      }
      btn.disabled = false;
    };
    $('wz-user-btn').onclick = () => void link();
    userInput.addEventListener('keydown', (e) => e.key === 'Enter' && void link());
    userInput.addEventListener('input', () => {
      login = '';
      $<HTMLButtonElement>('wz-1-next').disabled = true;
    });

    const finish = async () => {
      await api.settings.set({ githubUser: login, onboarded: true });
      steps.forEach((s) => s.classList.add('on'));
      $('wz-done-msg').textContent = web
        ? `@${login} vinculado.`
        : `@${login} vinculado · código creado · rostro ${faceDone ? 'activado' : 'omitido (puedes activarlo en Settings)'}.`;
      go(4);
    };

    $('wz-1-next').onclick = () => {
      if (!login) return;
      if (web) return void finish();
      const img = document.querySelector<HTMLImageElement>('#wz-ring .avatar');
      if (img) img.src = avatar;
      go(2);
    };

    // ---- step 2: verification code ----
    const pin = $<HTMLInputElement>('wz-pin');
    const pin2 = $<HTMLInputElement>('wz-pin2');
    const errPin = $('wz-pin-err');
    $('wz-gen').onclick = () => {
      const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10_000;
      pin.value = pin2.value = String(n).padStart(4, '0');
      pin.type = pin2.type = 'text';
      errPin.textContent = 'Este es tu código: anótalo en un lugar seguro, no se puede recuperar.';
    };
    $('wz-show').onclick = () => {
      pin.type = pin2.type = pin.type === 'password' ? 'text' : 'password';
    };
    $('wz-2-back').onclick = () => go(1);
    $('wz-2-next').onclick = async () => {
      if (!/^\d{4}$/.test(pin.value)) return void (errPin.textContent = 'El código debe tener 4 dígitos');
      if (pin.value !== pin2.value) return void (errPin.textContent = 'Los códigos no coinciden');
      const r = await api.face.setPin(pin.value);
      if (!r.ok) return void (errPin.textContent = r.error ?? 'No se pudo guardar el código');
      errPin.textContent = '';
      go(3);
    };

    // ---- step 3: face ----
    const ring = $('wz-ring');
    const msg = $('wz-face-msg');
    $('wz-face').onclick = async () => {
      const btn = $<HTMLButtonElement>('wz-face');
      btn.disabled = true;
      ring.classList.remove('fail');
      ring.classList.add('scanning');
      msg.textContent = 'Mira a la cámara y mueve un poco la cabeza…';
      const r = await api.face.enroll();
      ring.classList.remove('scanning');
      btn.disabled = false;
      if (r.ok) {
        faceDone = true;
        ring.classList.add('success');
        msg.textContent = '¡Rostro registrado!';
        setTimeout(() => void finish(), 900);
      } else {
        ring.classList.add('fail');
        setTimeout(() => ring.classList.remove('fail'), 500);
        msg.textContent = r.error ?? 'No se pudo registrar el rostro';
      }
    };
    $('wz-skip').onclick = () => void finish();

    // ---- step 4 ----
    $('wz-enter').onclick = () => {
      wizard.classList.add('hidden');
      resolve();
    };
  });
}
