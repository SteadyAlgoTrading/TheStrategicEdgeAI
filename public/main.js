document.addEventListener('DOMContentLoaded', () => {
  const cmd = document.getElementById('cmdk');
  if(cmd){
    cmd.addEventListener('input', e => {
      const v = e.target.value.toLowerCase();
      document.querySelectorAll('[data-cmd]').forEach(el => {
        el.style.display = el.dataset.cmd.includes(v) ? '' : 'none';
      });
    });
  }
});
