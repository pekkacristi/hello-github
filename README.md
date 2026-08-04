# hello-github
A practice repo where I learned Git and Github

## 🕵️ Imposter Who? — Party Word Game

A pass-and-play social deduction game for **3–12 players on one phone**, inspired by the "Imposter Who?" app. Everyone secretly sees the same word — except the imposter. Give one-word clues, argue, vote, and catch the fake!

### ▶️ How to run it
No build, no install — it's a single static page:

- **Open locally:** clone the repo and open `index.html` in any browser (best on a phone).
- **Host it:** enable GitHub Pages for this repo (Settings → Pages → deploy from branch) and play from the link on any phone.

### 🎭 Two game styles
- **📼 Original** — like the classic app: peek the cards, talk it out, then one tap reveals the imposter & word. No voting, no scores — pure conversation.
- **🚀 Evolution** — the full game: secret in-app voting with tie revotes, a caught imposter's last-chance word steal, score tracking, and a final podium.

### 🎮 How to play (Evolution)
1. **Secret word** — pass the phone around; each player holds the card to peek. Everyone sees the same word, except the imposter.
2. **Clues** — in the shown order, each player says one word related to the secret word. The imposter must bluff!
3. **Discuss & vote** — argue about who sounded fake, then vote secretly on the phone. Ties trigger one revote.
4. **The twist** — a caught imposter can still steal points by guessing the secret word from 8 options.

### ✨ Features
- **3 imposter modes:** Classic (imposter knows nothing), Hint (imposter gets a hint word similar to the secret word), and **Decoy** — the imposter gets a similar-but-wrong word and doesn't even know they're the imposter!
- 16 categories × 45 word pairs = 720 pairs — every secret word is unique across the whole game, with no near-duplicates (food, animals, movies, sports, video games, history & mythology, fictional characters, countries & cities, technology…)
- 3–20 players, 1–3 imposters for bigger groups, discussion timer, score tracking across rounds with a final podium 🏆
- Words never repeat until every selected category is exhausted; players, settings & scores are remembered between sessions

### 🧮 Scoring
| Outcome | Points |
|---|---|
| Imposter escapes the vote | **+4** for the imposter |
| Crew catches an imposter | **+2** for each crew member |
| Caught imposter guesses the word | **+2** bonus steal |

## Tech used
Git, GitHub, Markdown, HTML/CSS/JavaScript (no frameworks, no build step)
