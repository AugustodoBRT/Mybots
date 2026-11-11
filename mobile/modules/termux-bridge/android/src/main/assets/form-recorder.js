// Remembers the last form this page sent with POST. A file that comes back from one is not on any address: to keep it, the app
// has to send the same form again. It stays in this page's own memory and is read only when a download starts.
(() => {
  const remember = (form, submitter) => {
    window.__mybotsForm = null;
    try {
      const method = ((submitter && submitter.getAttribute('formmethod')) || form.getAttribute('method') || 'get').toLowerCase();
      if (method !== 'post') return;
      const fields = [];
      for (const [name, value] of (submitter ? new FormData(form, submitter) : new FormData(form))) if (typeof value === 'string') fields.push([name, value]);
      window.__mybotsForm = {
        action: new URL((submitter && submitter.getAttribute('formaction')) || form.getAttribute('action') || location.href, location.href).href,
        enctype: ((submitter && submitter.getAttribute('formenctype')) || form.getAttribute('enctype') || '').toLowerCase(),
        fields, at: Date.now(),
      };
    } catch (error) {}
  };
  const submit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () { remember(this); return submit.apply(this, arguments); };
  window.addEventListener('submit', event => { if (event.defaultPrevented) window.__mybotsForm = null; else remember(event.target, event.submitter); });
})();
