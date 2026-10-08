// Applies the saved or system theme before the first paint (external file: the CSP forbids inline scripts).
(function () {
  var theme;
  try {
    theme = localStorage.getItem("testhub.theme");
  } catch (error) {
    theme = null;
  }
  if (theme !== "light" && theme !== "dark")
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  document.documentElement.setAttribute("data-theme", theme);
})();
