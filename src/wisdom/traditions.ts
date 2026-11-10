/**
 * Every ethical tradition the wisdom map draws — studied or not.
 *
 * The map is meant to show the whole of human moral thought from the start, so
 * a tradition is listed here long before anything from it is chosen. One with
 * no entry in `pool.ts` is drawn as an unlit star; it lights up the day its
 * first passage is picked. The roster is the territory, the pool is the
 * journey through it.
 *
 * `year` is an approximate origin (negative = BCE) and only places the star:
 * older traditions sit nearer the centre, like rings in a tree. It is not a
 * claim about when a tradition "began" — most of these grew over centuries.
 */

export type Region =
  'africa' | 'near-east' | 'europe' | 'south-asia' | 'east-asia' | 'americas-oceania'

export interface RegionInfo {
  id: Region
  label: string
}

/** Clockwise from the top. Neighbours on the wheel are neighbours in history. */
export const REGIONS: readonly RegionInfo[] = [
  { id: 'near-east', label: 'Near East' },
  { id: 'south-asia', label: 'South Asia' },
  { id: 'east-asia', label: 'East Asia' },
  { id: 'americas-oceania', label: 'Americas & Oceania' },
  { id: 'africa', label: 'Africa' },
  { id: 'europe', label: 'Europe' }
]

export interface Tradition {
  id: string
  name: string
  region: Region
  /** Approximate origin, negative for BCE. Places the star; see the header. */
  year: number
  /** One line: what the tradition is, for the star's label and the card. */
  blurb: string
}

export const TRADITIONS: readonly Tradition[] = [
  // Near East
  {
    id: 'mesopotamian',
    name: 'Mesopotamian Wisdom',
    region: 'near-east',
    year: -2000,
    blurb: 'Sumerian and Babylonian instruction literature'
  },
  {
    id: 'hebrew-bible',
    name: 'Hebrew Bible',
    region: 'near-east',
    year: -800,
    blurb: 'Torah, Prophets and Writings'
  },
  {
    id: 'zoroastrianism',
    name: 'Zoroastrianism',
    region: 'near-east',
    year: -1000,
    blurb: 'Good thoughts, good words, good deeds'
  },
  {
    id: 'christianity',
    name: 'Christianity',
    region: 'near-east',
    year: 30,
    blurb: 'The teaching of Jesus and the New Testament'
  },
  {
    id: 'rabbinic',
    name: 'Rabbinic Judaism',
    region: 'near-east',
    year: 200,
    blurb: 'Mishnah, Talmud and Pirkei Avot'
  },
  {
    id: 'islam',
    name: 'Islam',
    region: 'near-east',
    year: 610,
    blurb: "The Qur'an and the Prophet's example"
  },
  {
    id: 'sufism',
    name: 'Sufism',
    region: 'near-east',
    year: 900,
    blurb: 'The inward, mystical path of Islam'
  },

  // South Asia
  {
    id: 'vedanta',
    name: 'Hindu Dharma',
    region: 'south-asia',
    year: -800,
    blurb: 'Upanishads, the Gita and dharma'
  },
  {
    id: 'jainism',
    name: 'Jainism',
    region: 'south-asia',
    year: -550,
    blurb: 'Non-violence toward every living thing'
  },
  {
    id: 'buddhism',
    name: 'Buddhism',
    region: 'south-asia',
    year: -500,
    blurb: 'The Dhammapada and the Noble Path'
  },
  {
    id: 'tirukkural',
    name: 'Tirukkural',
    region: 'south-asia',
    year: 400,
    blurb: 'Tamil couplets on virtue, wealth and love'
  },
  {
    id: 'sikhism',
    name: 'Sikhism',
    region: 'south-asia',
    year: 1500,
    blurb: 'Guru Granth Sahib: one creator, equal humanity'
  },

  // East Asia
  {
    id: 'confucianism',
    name: 'Confucianism',
    region: 'east-asia',
    year: -500,
    blurb: 'Humaneness, ritual and the cultivated self'
  },
  {
    id: 'daoism',
    name: 'Daoism',
    region: 'east-asia',
    year: -400,
    blurb: 'The Way that cannot be named'
  },
  {
    id: 'mohism',
    name: 'Mohism',
    region: 'east-asia',
    year: -430,
    blurb: 'Impartial care for all people'
  },
  {
    id: 'zen',
    name: 'Chan / Zen',
    region: 'east-asia',
    year: 600,
    blurb: 'Direct pointing at the mind'
  },
  {
    id: 'bushido',
    name: 'Japanese Ethics',
    region: 'east-asia',
    year: 1600,
    blurb: 'Shinto sincerity and the samurai code'
  },

  // Americas & Oceania
  {
    id: 'nahua',
    name: 'Nahua Wisdom',
    region: 'americas-oceania',
    year: 1400,
    blurb: 'Aztec huehuetlahtolli, the words of the elders'
  },
  {
    id: 'haudenosaunee',
    name: 'Haudenosaunee',
    region: 'americas-oceania',
    year: 1450,
    blurb: 'The Great Law of Peace'
  },
  {
    id: 'lakota',
    name: 'Lakota',
    region: 'americas-oceania',
    year: 1700,
    blurb: 'Mitakuye oyasin: all are related'
  },
  {
    id: 'polynesian',
    name: 'Polynesian',
    region: 'americas-oceania',
    year: 1000,
    blurb: 'Māori and Hawaiian proverbs of the people'
  },

  // Africa
  {
    id: 'maat',
    name: "Ma'at",
    region: 'africa',
    year: -2400,
    blurb: 'Ancient Egyptian order, truth and justice'
  },
  {
    id: 'ifa',
    name: 'Yoruba Ifá',
    region: 'africa',
    year: 1000,
    blurb: 'Iwa pele: gentle, good character'
  },
  {
    id: 'ethiopian',
    name: 'Ethiopian Philosophy',
    region: 'africa',
    year: 1667,
    blurb: "Zera Yacob's reasoned inquiry"
  },
  {
    id: 'ubuntu',
    name: 'Ubuntu',
    region: 'africa',
    year: 1800,
    blurb: 'A person is a person through other persons'
  },

  // Europe
  {
    id: 'greek',
    name: 'Classical Greek',
    region: 'europe',
    year: -430,
    blurb: 'Socrates, Plato and Aristotle on virtue'
  },
  {
    id: 'stoicism',
    name: 'Stoicism',
    region: 'europe',
    year: -300,
    blurb: 'Virtue is the only good'
  },
  {
    id: 'epicureanism',
    name: 'Epicureanism',
    region: 'europe',
    year: -300,
    blurb: 'Tranquil pleasure among friends'
  },
  {
    id: 'norse',
    name: 'Norse Wisdom',
    region: 'europe',
    year: 900,
    blurb: 'The Hávamál, sayings of the High One'
  },
  {
    id: 'enlightenment',
    name: 'Enlightenment Ethics',
    region: 'europe',
    year: 1785,
    blurb: 'Kant, Mill and the moral law'
  },
  {
    id: 'transcendentalism',
    name: 'Transcendentalism',
    region: 'americas-oceania',
    year: 1836,
    blurb: 'Emerson and Thoreau on self-reliance'
  }
]

export function traditionById(id: string): Tradition | undefined {
  return TRADITIONS.find(t => t.id === id)
}
