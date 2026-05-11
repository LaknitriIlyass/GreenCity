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
} 
catch (error) {
  console.error('Errore file:', error);
  utenti = [];
}

// --- Config ---
app.set('view engine', 'pug');
app.set('views', './views');

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- Helper: lettura/scrittura utenti ---
function getUsers() {
  return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
}

function saveUsers(users) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(users, null, 2));
}

// --- Middleware JWT (corretto) ---
function authenticateToken(req, res, next) {
  const token = req.cookies?.token;

  if (!token) return res.status(401).send("Non autorizzato");

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).send("Token non valido");
    req.user = user;
    next();
  });
}

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

// ═══════════════════════════════════════════════════════════════════
// ROUTE
// ═══════════════════════════════════════════════════════════════════

// --- Home ---
app.get('/', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.render('index', { utente: null });
  jwt.verify(token, SECRET_KEY, (err, user) => {
    res.render('index', { utente: err ? null : user });
  });
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

  let utente = null;
  const tok = req.cookies?.token;
  if (tok) { try { utente = jwt.verify(tok, SECRET_KEY); } catch(e){} }

  try {
    const geoRes = await fetch(
      `http://geodb-free-service.wirefreethought.com/v1/geo/cities/${encodeURIComponent(id)}`
    );
    const geoData = await geoRes.json();
    const city = geoData.data;

    if (!city || !city.latitude) return res.send("Città non trovata");

    const lat = city.latitude;
    const lon = city.longitude;
    const { start, end } = getDateRange(7);

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

    const ore    = storiaData.hourly?.time             || [];
    const aqi7   = storiaData.hourly?.european_aqi     || [];
    const pm25_7 = storiaData.hourly?.pm2_5            || [];
    const pm10_7 = storiaData.hourly?.pm10             || [];
    const no2_7  = storiaData.hourly?.nitrogen_dioxide || [];
    const o3_7   = storiaData.hourly?.ozone            || [];

    const indiciMezzogiorno = ore.reduce((acc, t, i) => {
      if (t.endsWith('T12:00')) acc.push(i);
      return acc;
    }, []);

    res.render('city', {
      nome:  city.city,
      geoId: id,
      utente,
      paese: city.country,
      meteo: meteoData.current_weather,

      aria: {
        aqi:     Math.round(aria.european_aqi    ?? 0),
        pm25:    +((aria.pm2_5                   ?? 0).toFixed(1)),
        pm10:    +((aria.pm10                    ?? 0).toFixed(1)),
        no2:     +((aria.nitrogen_dioxide        ?? 0).toFixed(1)),
        so2:     +((aria.sulphur_dioxide         ?? 0).toFixed(1)),
        o3:      +((aria.ozone                   ?? 0).toFixed(1)),
        co:      +((aria.carbon_monoxide         ?? 0).toFixed(1)),
        polveri: +((aria.dust                    ?? 0).toFixed(1)),
        uv:      +((aria.uv_index                ?? 0).toFixed(1)),
        livello: livelloAqi(aria.european_aqi ?? 0)
      },

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

// ═══════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════

// --- Login ---
app.get('/login', (req, res) => {
  res.render('login', { utente: null });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const users = getUsers();

  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.render('login', { errore: 'Email o password non corretti' });

  const token = jwt.sign(
    { email: user.email, nome: user.nome },
    SECRET_KEY,
    { expiresIn: '1h' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax'
  });

  res.redirect('/');
});

// --- Registrazione ---
app.get('/registrazione', (req, res) => {
  res.render('registrazione', { utente: null });
});

app.post('/registrazione', (req, res) => {
  const { nome, email, password } = req.body;
  const users = getUsers();

  const exists = users.find(u => u.email === email);
  if (exists) return res.render('registrazione', { errore: "Email già registrata. Usa un'altra email o vai al login." });

  const newUser = { id: Date.now(), nome, email, password };
  users.push(newUser);
  saveUsers(users);

  res.redirect('/login');
});

// --- Logout ---
app.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
});

// ═══════════════════════════════════════════════════════════════════
// PREFERITI
// ═══════════════════════════════════════════════════════════════════

function getPreferiti(email) {
  const users = getUsers();
  const user = users.find(u => u.email === email);
  return user?.preferiti || [];
}

function savePreferiti(email, preferiti) {
  const users = getUsers();
  const idx = users.findIndex(u => u.email === email);
  if (idx === -1) return;
  users[idx].preferiti = preferiti;
  saveUsers(users);
}

// Pagina preferiti
app.get('/preferiti', (req, res) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.render('preferiti', { utente: null, preferiti: [] });
  }

  jwt.verify(token, SECRET_KEY, async (err, user) => {
    if (err) return res.render('preferiti', { utente: null, preferiti: [] });

    const savedFavs = getPreferiti(user.email);

    if (!savedFavs.length) {
      return res.render('preferiti', { utente: user, preferiti: [] });
    }

    const enriched = await Promise.all(savedFavs.map(async (fav) => {
      try {
        let lat = fav.lat, lon = fav.lon;

        if (!lat || !lon) {
          const geoRes = await fetch(
            `http://geodb-free-service.wirefreethought.com/v1/geo/cities/${encodeURIComponent(fav.id)}`
          );
          const geoData = await geoRes.json();
          lat = geoData.data?.latitude;
          lon = geoData.data?.longitude;
        }

        if (!lat || !lon) throw new Error('Coordinate non trovate');

        const ariaRes = await fetch(
          `https://air-quality-api.open-meteo.com/v1/air-quality` +
          `?latitude=${lat}&longitude=${lon}&current=european_aqi,pm2_5,pm10`
        );
        const ariaData = await ariaRes.json();
        const curr = ariaData.current || {};

        const aqi = Math.round(curr.european_aqi ?? 0);
        return {
          id:    fav.id,
          nome:  fav.nome,
          paese: fav.paese,
          aqi,
          pm25:  +((curr.pm2_5 ?? 0).toFixed(1)),
          pm10:  +((curr.pm10  ?? 0).toFixed(1)),
          livello: livelloAqi(aqi)
        };
      } catch (e) {
        return {
          id:    fav.id,
          nome:  fav.nome,
          paese: fav.paese,
          aqi:   '—',
          pm25:  '—',
          pm10:  '—',
          livello: { testo: 'N/D', classe: 'muted', emoji: '⚪' }
        };
      }
    }));

    res.render('preferiti', { utente: user, preferiti: enriched });
  });
});

// Check se una città è tra i preferiti (risponde sempre JSON)
app.get('/preferiti/check/:id', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.json({ loggato: false, preferito: false });
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.json({ loggato: false, preferito: false });
    const favs = getPreferiti(user.email);
    const preferito = favs.some(f => String(f.id) === String(req.params.id));
    res.json({ loggato: true, preferito });
  });
});

// Toggle preferito (aggiungi / rimuovi)
app.post('/preferiti/toggle', authenticateToken, (req, res) => {
  const { id, nome, paese, rimuovi } = req.body;
  let favs = getPreferiti(req.user.email);

  const exists = favs.some(f => String(f.id) === String(id));

  if (exists || rimuovi) {
    favs = favs.filter(f => String(f.id) !== String(id));
    savePreferiti(req.user.email, favs);
    return res.json({ preferito: false });
  } else {
    favs.push({ id, nome, paese });
    savePreferiti(req.user.email, favs);
    return res.json({ preferito: true });
  }
});

// ═══════════════════════════════════════════════════════════════════
// CLASSIFICA
// ═══════════════════════════════════════════════════════════════════

const CITTA_MONDIALI = [
  { nome: 'Reykjavik',  paese: 'Iceland',     lat: 64.1355,  lon: -21.8954  },
  { nome: 'Helsinki',   paese: 'Finland',     lat: 60.1699,  lon: 24.9384   },
  { nome: 'Oslo',       paese: 'Norway',      lat: 59.9139,  lon: 10.7522   },
  { nome: 'Stockholm',  paese: 'Sweden',      lat: 59.3293,  lon: 18.0686   },
  { nome: 'Tallinn',    paese: 'Estonia',     lat: 59.4370,  lon: 24.7536   },
  { nome: 'Vilnius',    paese: 'Lithuania',   lat: 54.6872,  lon: 25.2797   },
  { nome: 'Dublin',     paese: 'Ireland',     lat: 53.3498,  lon: -6.2603   },
  { nome: 'Riga',       paese: 'Latvia',      lat: 56.9460,  lon: 24.1059   },
  { nome: 'Copenhagen', paese: 'Denmark',     lat: 55.6761,  lon: 12.5683   },
  { nome: 'Ljubljana',  paese: 'Slovenia',    lat: 46.0569,  lon: 14.5058   },
  { nome: 'Brussels',   paese: 'Belgium',     lat: 50.8503,  lon: 4.3517    },
  { nome: 'Bern',       paese: 'Switzerland', lat: 46.9480,  lon: 7.4474    },
  { nome: 'Wellington', paese: 'New Zealand', lat: -41.2865, lon: 174.7762  },
  { nome: 'Vancouver',  paese: 'Canada',      lat: 49.2827,  lon: -123.1207 },
  { nome: 'Canberra',   paese: 'Australia',   lat: -35.2809, lon: 149.1300  },
];

async function calcolaTop10(citta) {
  const risultati = await Promise.all(citta.map(async (c) => {
    try {
      const res  = await fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality` +
        `?latitude=${c.lat}&longitude=${c.lon}&current=european_aqi,pm2_5,pm10`
      );
      const data = await res.json();
      const curr = data.current || {};
      return {
        nome:  c.nome,
        paese: c.paese,
        geoId: c.geoId || null,
        aqi:   Math.round(curr.european_aqi ?? 999),
        pm25:  +((curr.pm2_5 ?? 0).toFixed(1)),
        pm10:  +((curr.pm10  ?? 0).toFixed(1)),
      };
    } catch (e) {
      return null;
    }
  }));

  return risultati
    .filter(r => r !== null && r.aqi < 999)
    .sort((a, b) => a.aqi - b.aqi)
    .slice(0, 10);
}

function aggiungiLivello(classifica) {
  return classifica.map(c => {
    let livello;
    if      (c.aqi <= 20) livello = { testo: 'Buona',    classe: 'success' };
    else if (c.aqi <= 40) livello = { testo: 'Discreta', classe: 'info'    };
    else if (c.aqi <= 60) livello = { testo: 'Moderata', classe: 'warning' };
    else if (c.aqi <= 80) livello = { testo: 'Scarsa',   classe: 'danger'  };
    else                  livello = { testo: 'Pessima',  classe: 'danger'  };
    return { ...c, livello };
  });
}

app.get('/classifica', async (req, res) => {
  try {
    const top10 = await calcolaTop10(CITTA_MONDIALI);
    const tok = req.cookies?.token;
    let utente = null;
    if (tok) { try { utente = jwt.verify(tok, SECRET_KEY); } catch(e){} }
    res.render('classifica', {
      classifica: aggiungiLivello(top10),
      titolo:     'Top 10 mondiale',
      codice:     null,
      utente
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore nel caricamento della classifica');
  }
});

app.post('/classifica', (req, res) => {
  const codice = (req.body.codice || '').trim().toUpperCase();
  if (!codice) return res.redirect('/classifica');
  res.redirect(`/classifica/${codice}`);
});

app.get('/classifica/:codice', async (req, res) => {
  const codice = req.params.codice.toUpperCase();

  try {
    const geoRes = await fetch(
      `http://geodb-free-service.wirefreethought.com/v1/geo/cities` +
      `?countryIds=${codice}&minPopulation=100000&limit=10&types=CITY&sort=-population`
    );
    const geoData = await geoRes.json();

    console.log(`GeoDB [${codice}] risultati:`, geoData.data?.length ?? 0, 'città');

    if (!geoData.data || geoData.data.length === 0) {
      return res.render('classifica', {
        classifica: [],
        titolo:     `Nessuna città trovata per "${codice}"`,
        codice
      });
    }

    const citta = geoData.data.map(c => ({
      nome:  c.city,
      paese: c.country,
      lat:   c.latitude,
      lon:   c.longitude,
      geoId: c.id
    }));

    const top10 = await calcolaTop10(citta);

    res.render('classifica', {
      classifica: aggiungiLivello(top10),
      titolo:     `Top 10 — ${citta[0].paese}`,
      codice
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Errore nel caricamento della classifica');
  }
});

// --- Avvio server ---
app.listen(3000, () => {
  console.log('Server avviato su http://localhost:3000');
});