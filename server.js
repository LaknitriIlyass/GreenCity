const express = require('express');
const fs = require('fs');
const path = require('path');
 
const app = express();
const FILE_PATH = path.join(__dirname, '/json/utenti.json');
 
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
require("dotenv").config();
 
app.use(cookieParser());
 
const SECRET_KEY = process.env.JWT_SECRET || "supersegreto";
 
// --- Gestione file utenti ---
let utenti = [];
 
try {
  if (fs.existsSync(FILE_PATH)) {
    const data = fs.readFileSync(FILE_PATH, 'utf8');
    utenti = JSON.parse(data);
  } else {
    console.log('File utenti.json non trovato, creazione...');
    fs.writeFileSync(FILE_PATH, JSON.stringify([]));
  }
} catch (error) {
  console.error('Errore file:', error);
  utenti = [];
}
 
// --- Config ---
app.set('view engine', 'pug');
app.set('views', './views');
 
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
 
// --- Helper: livello AQI ---
function livelloAqi(aqi) {
  if (aqi <= 20) return { testo: 'Buona',    classe: 'success', emoji: '🟢' };
  if (aqi <= 40) return { testo: 'Discreta', classe: 'info',    emoji: '🔵' };
  if (aqi <= 60) return { testo: 'Moderata', classe: 'warning', emoji: '🟡' };
  if (aqi <= 80) return { testo: 'Scarsa',   classe: 'orange',  emoji: '🟠' };
  return             { testo: 'Pessima',     classe: 'danger',  emoji: '🔴' };
}
 
// --- Helper: date ultimi N giorni ---
function getDateRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  return {
    start: start.toISOString().split('T')[0],
    end:   end.toISOString().split('T')[0]
  };
}
 
//login utenti
function getUsers() {
 
    return JSON.parse(fs.readFileSync(FILE_PATH, "utf8"));
 
}
 
function saveUsers(users) {
 
    fs.writeFileSync(FILE_PATH, JSON.stringify(users, null, 2));
 
}
 
function authenticateToken(req, res, next) {
 
  const token = jwt.sign(
      { email: user.email, nome: user.nome }, 
      SECRET_KEY,
      { expiresIn: "1h" }
  );
 
  if (!token) return res.status(401).send("Non autorizzato");
 
  jwt.verify(token, SECRET_KEY, (err, user) => {
      if (err) return res.status(403).send("Token non valido");
 
      req.user = user;
      next();
  });
}
 
// --- Home ---
app.get('/', (req, res) => {
  res.render('index');
});
 
// --- API città (autocomplete) ---
app.get('/api/citta', async (req, res) => {
  const query = req.query.q;
  if (!query || query.length < 2) return res.json([]);
 
  try {
    const response = await fetch(
      `http://geodb-free-service.wirefreethought.com/v1/geo/cities?namePrefix=${encodeURIComponent(query)}&limit=5&types=CITY&minPopulation=40000`
    );
    const data = await response.json();
    if (!data.data) return res.json([]);
 
    const cities = data.data.map(c => ({
      id: c.id,
      label: `${c.city}, ${c.country}`
    }));
    res.json(cities);
 
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Errore API" });
  }
});
 
// --- Pagina città ---
app.get('/citta/:id', async (req, res) => {
  const id = req.params.id;
 
  try {
    // 1. Coordinate
    const geoRes = await fetch(
      `http://geodb-free-service.wirefreethought.com/v1/geo/cities/${encodeURIComponent(id)}`
    );
    const geoData = await geoRes.json();
    const city = geoData.data;
 
    if (!city || !city.latitude) return res.send("Città non trovata");
 
    const lat = city.latitude;
    const lon = city.longitude;
    const { start, end } = getDateRange(7);
 
    // 2. Tutte le chiamate in parallelo
    const [meteoRes, ariaRes, storiaRes] = await Promise.all([
 
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`),
 
      fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
            `&current=european_aqi,pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide,dust,uv_index`),
 
      fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
            `&hourly=european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone` +
            `&start_date=${start}&end_date=${end}&timezone=auto`)
    ]);
 
    const meteoData  = await meteoRes.json();
    const ariaData   = await ariaRes.json();
    const storiaData = await storiaRes.json();
 
    const aria = ariaData.current || {};
 
    // 3. Dati storici — 1 punto per giorno (ora 12:00)
    const ore    = storiaData.hourly?.time              || [];
    const aqi7   = storiaData.hourly?.european_aqi      || [];
    const pm25_7 = storiaData.hourly?.pm2_5             || [];
    const pm10_7 = storiaData.hourly?.pm10              || [];
    const no2_7  = storiaData.hourly?.nitrogen_dioxide  || [];
    const o3_7   = storiaData.hourly?.ozone             || [];
 
    const indiciMezzogiorno = ore.reduce((acc, t, i) => {
      if (t.endsWith('T12:00')) acc.push(i);
      return acc;
    }, []);
 
    res.render('city', {
      nome:  city.city,
      paese: city.country,
      meteo: meteoData.current_weather,
 
      aria: {
        aqi:     Math.round(aria.european_aqi     ?? 0),
        pm25:    +((aria.pm2_5                    ?? 0).toFixed(1)),
        pm10:    +((aria.pm10                     ?? 0).toFixed(1)),
        no2:     +((aria.nitrogen_dioxide         ?? 0).toFixed(1)),
        so2:     +((aria.sulphur_dioxide          ?? 0).toFixed(1)),
        o3:      +((aria.ozone                    ?? 0).toFixed(1)),
        co:      +((aria.carbon_monoxide          ?? 0).toFixed(1)),
        polveri: +((aria.dust                     ?? 0).toFixed(1)),
        uv:      +((aria.uv_index                 ?? 0).toFixed(1)),
        livello: livelloAqi(aria.european_aqi ?? 0)
      },
 
      // JSON per Chart.js nel browser
      storico: JSON.stringify({
        labels: indiciMezzogiorno.map(i => ore[i].split('T')[0]),
        aqi:    indiciMezzogiorno.map(i => aqi7[i]   ?? null),
        pm25:   indiciMezzogiorno.map(i => pm25_7[i] ?? null),
        pm10:   indiciMezzogiorno.map(i => pm10_7[i] ?? null),
        no2:    indiciMezzogiorno.map(i => no2_7[i]  ?? null),
        o3:     indiciMezzogiorno.map(i => o3_7[i]   ?? null)
      })
    });
 
  } catch (err) {
    console.error(err);
    res.status(500).send("Errore nel caricamento dati");
  }
});
 
// --- Login ---
app.get('/login', (req, res) => {
  res.render('login');
});
 
app.post("/login", (req, res) => {
 
  const { username, password } = req.body;
  const users = getUsers();
 
  const user = users.find(
      u => u.email === username && u.password === password  // ✅ confronta email
  );
 
  if (!user)
      return res.status(401).json({ message: "Credenziali errate" });
 
  const token = jwt.sign(
      { username: user.username },
      SECRET_KEY,
      { expiresIn: "1h" }
  );
 
  res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax"
  });
 
  res.json({ message: "Login effettuato" });
});
 
// --- Registrazione ---
app.get('/registrazione', (req, res) => {
  res.render('registrazione');
});
 
app.post("/registrazione", (req, res) => {
  const { nome, email, password } = req.body;
  const users = getUsers();
 
  const exists = users.find(u => u.email === email);
  if (exists) return res.render('registrazione', { errore: 'Email già registrata. Usa un\'altra email o vai al login.' });
 
  const newUser = { id: Date.now(), nome, email, password };
  users.push(newUser);
  saveUsers(users);
 
  res.redirect('/');
});
 
app.post("/logout", (req, res) => {
 
    res.clearCookie("token");
 
    res.json({ message: "Logout effettuato" });
 
});
 
app.get("/preferiti", authenticateToken, (req, res) => {
    res.send("Pagina protetta");
});
 
// --- Avvio server ---
app.listen(3000, () => {
  console.log('Server avviato su http://localhost:3000');
});