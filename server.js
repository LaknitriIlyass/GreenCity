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


