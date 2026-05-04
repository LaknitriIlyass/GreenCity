const express = require('express'); 
const fs = require('fs');
const path = require('path');
const app = express();

const FILE_PATH = path.join(__dirname, '/json/utenti.json');

let utenti;
try {
  if (fs.existsSync(FILE_PATH)) {
    const data = fs.readFileSync(FILE_PATH, 'utf8');
    utenti = JSON.parse(data); 
  } else {
    console.log('File utenti.json non trovato, creazione in corso...');
    fs.writeFileSync(FILE_PATH, JSON.stringify([])); // Creazione file JSON vuoto
  }
} catch (error) {
  console.error('Errore nella gestione del file:', error);
  utenti = []; // Se il file era corrotto, resettiamo l'array per evitare crash
}

app.set('view engine', 'pug');
app.set('views', './views');

app.use(express.static('public'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => {
    res.render('index');
});

// API città (autocomplete)
app.get('/api/citta', async (req, res) => {
    const query = req.query.q;

    if (!query || query.length < 2) {
        return res.json([]);
    }

    try {
        const response = await fetch(
            `https://wft-geo-db.p.rapidapi.com/v1/geo/cities?namePrefix=${query}&limit=5&types=CITY&minPopulation=50000`,
            {
                headers: {
                    "X-RapidAPI-Key": "25b35ee295msh84cdfa40d2305e6p12be1ejsnea1316c0f5b2",
                    "X-RapidAPI-Host": "wft-geo-db.p.rapidapi.com"
                }
            }
        );

        const data = await response.json();

        const cities = data.data.map(c => c.city);

        res.json(cities);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Errore API" });
    }
});

app.listen(3000, () => {
    console.log('Server avviato su http://localhost:3000');
});


