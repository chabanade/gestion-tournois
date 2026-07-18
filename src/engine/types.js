// @ts-check
/**
 * Types du moteur (JSDoc uniquement, aucun code exécuté).
 *
 * @typedef {'roundRobin'|'knockout'|'groupsKnockout'|'championship'} Format
 *
 * @typedef {Object} Team
 * @property {string} id
 * @property {string} name
 * @property {string} [divisionId]  poule d'appartenance (formats à poules)
 * @property {number} [seed]        tête de série (1 = meilleure)
 * @property {string} [logoRef]     référence vers un logo stocké (Blob/base64)
 *
 * @typedef {Object} Division
 * @property {string} id
 * @property {string} name
 * @property {string[]} teamIds
 * @property {number} [qualifyCount]  nb d'équipes qualifiées pour les phases finales
 *
 * @typedef {Object} MatchRef
 * @property {string} matchId
 * @property {'winner'|'loser'} outcome
 *
 * @typedef {Object} MatchResult
 * @property {number} homeGoals
 * @property {number} awayGoals
 * @property {('home'|'away'|null)} [forfeit]
 * @property {({home:number, away:number}|null)} [penalties]  tirs au but (nul en KO)
 * @property {{home:number, away:number}} [fairPlay]          points disciplinaires (malus)
 * @property {boolean} finished
 *
 * @typedef {Object} Slot
 * @property {number} court     numéro de terrain (1..n)
 * @property {number} startMin  minutes depuis minuit
 * @property {number} endMin
 *
 * @typedef {Object} Match
 * @property {string} id
 * @property {string} [divisionId]
 * @property {'group'|'knockout'} phase
 * @property {number} round      journée (poule) ou tour (arbre, 0 = premier tour)
 * @property {number} [slotInRound]  position dans le tour (arbre)
 * @property {(string|null)} homeId  null tant que le qualifié est inconnu
 * @property {(string|null)} awayId
 * @property {MatchRef} [homeSource] arbre : d'où vient l'équipe à domicile
 * @property {MatchRef} [awaySource]
 * @property {string} [homeToken]   jeton de qualification de poule (ex "Q:1:0"), résolu quand la poule est finie
 * @property {string} [awayToken]
 * @property {string} [label]        ex "Finale", "3e place"
 * @property {MatchResult} [result]
 * @property {Slot} [slot]
 *
 * @typedef {'points'|'headToHead'|'goalDiff'|'goalsFor'|'goalsAgainst'|'wins'|'disciplinary'|'drawLots'} TiebreakerId
 *
 * @typedef {Object} Tiebreaker
 * @property {TiebreakerId} id
 * @property {'asc'|'desc'} [direction]  sens de tri (par défaut desc, sauf goalsAgainst/disciplinary = asc)
 *
 * @typedef {Object} Ruleset
 * @property {number} winPoints
 * @property {number} drawPoints
 * @property {number} lossPoints
 * @property {[number, number]} forfeitScore  [buts encaissés par le forfaitaire, buts marqués par l'adversaire]
 * @property {number} [forfeitLosePoints]     pénalité de points pour l'équipe forfait (ex FFF: -1)
 * @property {Tiebreaker[]} tiebreakers        ORDONNÉS
 * @property {boolean} [fairPlayAffectsPoints] si vrai, le fair-play retire des points au classement
 *
 * @typedef {Object} ScheduleConfig
 * @property {number} courts          nb de terrains (1..n)
 * @property {number} matchDurationMin
 * @property {number} breakMin
 * @property {number} startMin        minutes depuis minuit
 * @property {number} [endMin]        borne haute optionnelle
 * @property {boolean} [avoidBackToBack]
 * @property {number} [minRestSlots]  nb minimum de créneaux de repos entre 2 matchs d'une équipe
 *
 * @typedef {Object} Branding
 * @property {string} [logoRef]
 * @property {string} [primaryColor]
 * @property {string} [secondaryColor]
 * @property {Array<{name:string, logoRef?:string, url?:string}>} [sponsors]
 *
 * @typedef {Object} Standing
 * @property {string} teamId
 * @property {number} rank
 * @property {number} played
 * @property {number} won
 * @property {number} drawn
 * @property {number} lost
 * @property {number} goalsFor
 * @property {number} goalsAgainst
 * @property {number} goalDiff
 * @property {number} points
 * @property {number} disciplinary   total des points disciplinaires (malus)
 * @property {string[]} [tiedWith]    ex aequo non départageables (flag explicite)
 * @property {TiebreakerId} [resolvedBy]  critère ayant tranché le rang
 *
 * @typedef {Object} Tournament
 * @property {string} id
 * @property {string} name
 * @property {Format} format
 * @property {number} seq            version monotone (préparation de la sync)
 * @property {string} rngSeed        seed du tirage au sort déterministe
 * @property {Division[]} divisions
 * @property {Team[]} teams
 * @property {Match[]} matches
 * @property {ScheduleConfig} schedule
 * @property {Ruleset} ruleset
 * @property {Branding} [branding]
 * @property {{doubleLeg?:boolean, groupCount?:number, qualifiersPerGroup?:number, thirdPlace?:boolean}} [options]
 */

/** Jeu de règles par défaut : football amateur, points 3/1/0. */
export const DEFAULT_RULESET = /** @type {Ruleset} */ ({
  winPoints: 3,
  drawPoints: 1,
  lossPoints: 0,
  forfeitScore: [0, 3],
  forfeitLosePoints: 0,
  fairPlayAffectsPoints: false,
  tiebreakers: [
    { id: 'points' },
    { id: 'headToHead' },
    { id: 'goalDiff' },
    { id: 'goalsFor' },
    { id: 'drawLots' },
  ],
});

/** Configuration de planning par défaut. */
export const DEFAULT_SCHEDULE = /** @type {ScheduleConfig} */ ({
  courts: 1,
  matchDurationMin: 15,
  breakMin: 5,
  startMin: 9 * 60,
  avoidBackToBack: true,
  minRestSlots: 1,
});

export {};
