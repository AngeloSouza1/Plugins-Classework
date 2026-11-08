// Tema de vídeo em tela cheia: toca o <video id="v" data-src="..."> em loop, sem som.
// Opções (vindas do app): brightness (20 a 100), contrast (0,7 a 1,5), saturation (0 a 2),
// speed (0,5 a 2), fit ("cover" | "contain").
(function () {
  "use strict";

  var DEFAULTS = { brightness: 100, contrast: 1, saturation: 1, speed: 1, fit: "cover" };
  var video = document.getElementById("v");
  var msg = document.getElementById("msg");
  var current = {};

  function apply(opts) {
    var m = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      m[k] = opts && opts[k] !== undefined ? opts[k] : DEFAULTS[k];
    });
    video.style.filter = "brightness(" + (m.brightness / 100) + ") contrast(" + m.contrast + ") saturate(" + m.saturation + ")";
    video.style.objectFit = m.fit === "contain" ? "contain" : "cover";
    video.defaultPlaybackRate = m.speed;
    video.playbackRate = m.speed;
    current = m;
  }

  function play() {
    var p = video.play();
    if (p && p.catch) p.catch(function () { /* autoplay sem som costuma ser liberado; se não, o próximo gesto toca */ });
  }

  video.addEventListener("error", function () {
    msg.style.display = "flex"; // arquivo ausente ou formato que o navegador não toca
  });
  // Pausa com a aba oculta (poupa bateria) e retoma ao voltar.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) video.pause();
    else play();
  });

  apply({});
  video.muted = true;
  video.loop = true;
  video.src = video.getAttribute("data-src");
  play();

  ScreensaverTheme.init({
    autoWake: true,
    onState: function (s) { apply(s.options); }
  });
})();
