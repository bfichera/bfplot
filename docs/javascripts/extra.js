document.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("bfplot-color-scheme");
  if (!saved) return;
  const input = document.querySelector(`input[data-md-color-scheme="${saved}"]`);
  if (input instanceof HTMLInputElement) input.click();
});

document.addEventListener("change", (event) => {
  const input = event.target;
  if (input instanceof HTMLInputElement && input.dataset.mdColorScheme) {
    localStorage.setItem("bfplot-color-scheme", input.dataset.mdColorScheme);
  }
});
