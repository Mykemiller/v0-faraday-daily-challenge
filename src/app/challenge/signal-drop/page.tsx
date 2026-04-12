'use client';

import { useState, useEffect } from 'react';

interface LetterState {
  letter: string;
  state: 'correct' | 'wrong-position' | 'not-in-word' | 'neutral';
}

interface GuessedLetter {
  letter: string;
  state: 'correct' | 'wrong-position' | 'not-in-word';
}

const QWERTY_LAYOUT = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

const ANSWER = 'BUSBAR';
const DOMAIN_HINT = 'Power Architecture';
const DEFINITION =
  'A heavy copper or aluminum bar that conducts large amounts of electrical current within a power distribution system.';
const MAX_ATTEMPTS = 6;

export default function SignalDropPage() {
  const [guesses, setGuesses] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [gameStatus, setGameStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [showHint, setShowHint] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [keyStates, setKeyStates] = useState<Record<string, LetterState['state']>>({});

  const answerLength = ANSWER.length;
  const isGameOver = gameStatus !== 'playing';
  const attempsRemaining = MAX_ATTEMPTS - guesses.length;

  // Handle physical keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isGameOver) return;

      const key = e.key.toUpperCase();

      if (/^[A-Z]$/.test(key) && currentInput.length < answerLength) {
        setCurrentInput((prev) => prev + key);
        e.preventDefault();
      } else if (key === 'BACKSPACE') {
        setCurrentInput((prev) => prev.slice(0, -1));
        e.preventDefault();
      } else if (key === 'ENTER') {
        handleSubmitGuess();
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentInput, isGameOver, answerLength]);

  const getLetterState = (
    letter: string,
    position: number,
    guess: string
  ): LetterState['state'] => {
    if (guess[position] === ANSWER[position]) {
      return 'correct';
    } else if (ANSWER.includes(letter)) {
      return 'wrong-position';
    } else {
      return 'not-in-word';
    }
  };

  const updateKeyStates = (guess: string) => {
    const newKeyStates = { ...keyStates };

    for (let i = 0; i < guess.length; i++) {
      const letter = guess[i];
      const state = getLetterState(letter, i, guess);

      // Only update if this is a better state (correct > wrong-position > not-in-word)
      if (!newKeyStates[letter]) {
        newKeyStates[letter] = state;
      } else if (
        (state === 'correct' && newKeyStates[letter] !== 'correct') ||
        (state === 'wrong-position' && newKeyStates[letter] === 'not-in-word')
      ) {
        newKeyStates[letter] = state;
      }
    }

    setKeyStates(newKeyStates);
  };

  const handleSubmitGuess = () => {
    if (currentInput.length !== answerLength) return;

    const guess = currentInput.toUpperCase();
    const newGuesses = [...guesses, guess];
    setGuesses(newGuesses);
    updateKeyStates(guess);

    if (guess === ANSWER) {
      setGameStatus('won');
    } else if (newGuesses.length >= MAX_ATTEMPTS) {
      setGameStatus('lost');
    }

    setCurrentInput('');
  };

  const handleOnScreenKeyClick = (letter: string) => {
    if (isGameOver || currentInput.length >= answerLength) return;
    setCurrentInput((prev) => prev + letter);
  };

  const handleBackspace = () => {
    setCurrentInput((prev) => prev.slice(0, -1));
  };

  const handleNewPuzzle = () => {
    setGuesses([]);
    setCurrentInput('');
    setGameStatus('playing');
    setShowHint(false);
    setHintUsed(false);
    setKeyStates({});
  };

  const getScore = (): number => {
    if (gameStatus === 'lost') return 5;
    const scoreMap = [100, 90, 75, 60, 40, 20];
    return scoreMap[guesses.length - 1] || 0;
  };

  const getLetterColor = (position: number, guessIndex: number): string => {
    if (guessIndex >= guesses.length) {
      if (guessIndex === guesses.length) {
        return 'bg-warm-cream border-warm-gray';
      }
      return 'bg-warm-white border-warm-cream';
    }

    const guess = guesses[guessIndex];
    const letter = guess[position];
    const state = getLetterState(letter, position, guess);

    if (state === 'correct') {
      return 'bg-forest text-warm-white';
    } else if (state === 'wrong-position') {
      return 'bg-gold text-near-black';
    } else {
      return 'bg-warm-gray text-warm-white';
    }
  };

  const getKeyColor = (letter: string): string => {
    const state = keyStates[letter];
    if (!state) return 'bg-warm-cream text-near-black hover:bg-warm-cream';
    if (state === 'correct') return 'bg-forest text-warm-white';
    if (state === 'wrong-position') return 'bg-gold text-near-black';
    return 'bg-warm-gray text-warm-white';
  };

  return (
    <div className="min-h-screen bg-warm-white flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-5xl md:text-6xl font-bold text-forest mb-2">📡 Signal Drop</h1>
        <p className="text-xl text-forest-mid">Guess the hidden industry term</p>
      </div>

      {/* Attempts remaining */}
      <div className="mb-6 text-center">
        <p className="text-lg font-semibold text-forest">
          Attempts remaining: <span className="text-gold">{attempsRemaining}</span>
        </p>
      </div>

      {/* Game Grid */}
      <div className="mb-8 flex flex-col gap-2">
        {Array.from({ length: MAX_ATTEMPTS }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex gap-2 justify-center">
            {Array.from({ length: answerLength }).map((_, colIndex) => {
              const isCurrentRow = rowIndex === guesses.length;
              const letter =
                isCurrentRow && colIndex < currentInput.length
                  ? currentInput[colIndex]
                  : guesses[rowIndex]?.[colIndex] || '';

              return (
                <div
                  key={`${rowIndex}-${colIndex}`}
                  className={`
                    w-12 h-12 md:w-14 md:h-14 flex items-center justify-center
                    font-bold text-lg md:text-xl border-2
                    transition-all duration-300 rounded
                    ${getLetterColor(colIndex, rowIndex)}
                  `}
                >
                  {letter}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Domain Flash Hint Button */}
      {!hintUsed && !showHint && (
        <button
          onClick={() => {
            setShowHint(true);
            setHintUsed(true);
          }}
          className="mb-6 px-4 py-2 bg-gold hover:bg-gold-light text-near-black font-semibold rounded transition-colors"
        >
          💡 Domain Flash Hint
        </button>
      )}

      {/* Hint Display */}
      {showHint && (
        <div className="mb-6 p-4 bg-warm-cream border-2 border-gold rounded text-center">
          <p className="font-semibold text-forest">Domain: {DOMAIN_HINT}</p>
        </div>
      )}

      {/* Game Over States */}
      {gameStatus === 'won' && (
        <div className="mb-8 p-6 bg-forest rounded-lg text-center text-warm-white max-w-md">
          <h2 className="text-3xl font-bold mb-2">🎉 You Won!</h2>
          <p className="text-lg mb-4">Score: <span className="text-gold font-bold text-2xl">{getScore()}</span></p>
          <p className="mb-4">
            <span className="font-bold text-gold">{ANSWER}</span> — {DEFINITION}
          </p>
          <button
            onClick={handleNewPuzzle}
            className="w-full bg-gold hover:bg-gold-light text-near-black font-bold py-2 rounded transition-colors"
          >
            New Puzzle
          </button>
        </div>
      )}

      {gameStatus === 'lost' && (
        <div className="mb-8 p-6 bg-warm-gray rounded-lg text-center text-warm-white max-w-md">
          <h2 className="text-3xl font-bold mb-2">Game Over</h2>
          <p className="text-lg mb-4">The answer was: <span className="font-bold text-gold text-xl">{ANSWER}</span></p>
          <p className="mb-4">
            {ANSWER} — {DEFINITION}
          </p>
          <button
            onClick={handleNewPuzzle}
            className="w-full bg-gold hover:bg-gold-light text-near-black font-bold py-2 rounded transition-colors"
          >
            New Puzzle
          </button>
        </div>
      )}

      {/* On-Screen Keyboard */}
      {!isGameOver && (
        <div className="w-full max-w-2xl">
          {QWERTY_LAYOUT.map((row, rowIndex) => (
            <div key={rowIndex} className="flex gap-1 justify-center mb-2">
              {row.map((letter) => (
                <button
                  key={letter}
                  onClick={() => handleOnScreenKeyClick(letter)}
                  disabled={isGameOver || currentInput.length >= answerLength}
                  className={`
                    px-2 py-2 md:px-3 md:py-2 text-sm md:text-base font-semibold
                    rounded transition-colors duration-200
                    ${getKeyColor(letter)}
                    disabled:opacity-50
                  `}
                >
                  {letter}
                </button>
              ))}
            </div>
          ))}

          {/* Control buttons */}
          <div className="flex gap-2 justify-center mt-4">
            <button
              onClick={handleBackspace}
              disabled={currentInput.length === 0}
              className="px-4 py-2 bg-warm-gray hover:bg-forest text-warm-white font-semibold rounded disabled:opacity-50 transition-colors"
            >
              ← Backspace
            </button>
            <button
              onClick={handleSubmitGuess}
              disabled={currentInput.length !== answerLength}
              className="px-4 py-2 bg-gold hover:bg-gold-light text-near-black font-semibold rounded disabled:opacity-50 transition-colors"
            >
              Enter ↵
            </button>
          </div>
        </div>
      )}

      {/* Footer info */}
      <div className="mt-12 text-center text-forest-mid text-sm">
        <p>Type with your keyboard or use the on-screen buttons</p>
        <p className="mt-2">Scoring: 1=100, 2=90, 3=75, 4=60, 5=40, 6=20, Fail=5</p>
      </div>
    </div>
  );
}
