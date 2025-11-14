// bot.js — Dream & Marlow HT1 PvP bots
// Yêu cầu: node 18+, mineflayer 4.20+, pathfinder, pvp, auto-eat, vec3

const mineflayer = require('mineflayer')
const {
  pathfinder,
  Movements
} = require('mineflayer-pathfinder')
const autoEat = require('mineflayer-auto-eat').plugin
const pvp = require('mineflayer-pvp').plugin
const { Vec3 } = require('vec3')

const SERVER_HOST = process.env.SERVER_HOST || 'node1.lumine.asia'
const SERVER_PORT = Number(process.env.SERVER_PORT || 25675)
const AUTH_MODE = process.env.AUTH_MODE || 'offline'

// 2 bot tên như yêu cầu
const BOT_NAMES = ['Dream', 'Marlow']

function wait (ms) {
  return new Promise(res => setTimeout(res, ms))
}

function findItem (bot, names) {
  const list = Array.isArray(names) ? names : [names]
  return bot.inventory.items().find(it => list.includes(it.name))
}

function findFirstItem (bot, names) {
  return findItem(bot, names)
}

function getNearestEnemyPlayer (bot, maxDistance) {
  let best = null
  let bestDist = maxDistance
  for (const id in bot.entities) {
    const e = bot.entities[id]
    if (!e || e.type !== 'player') continue
    if (!e.username || e.username === bot.username) continue
    if (!e.position) continue

    const dist = bot.entity.position.distanceTo(e.position)
    if (dist < bestDist) {
      best = e
      bestDist = dist
    }
  }
  return best
}

function isEntityInWeb (bot, entity) {
  if (!entity || !entity.position) return false
  const feet = entity.position.offset(0, 0.1, 0)
  const block = bot.blockAt(feet)
  if (!block) return false
  return block.name && block.name.includes('web') // cobweb / web
}

function isBotInWeb (bot) {
  return isEntityInWeb(bot, bot.entity)
}

async function ensureOffhand (bot) {
  try {
    const hp = bot.health // 0–20 (mỗi 2 = 1 tim)
    if (hp <= 0) return

    const totem = findFirstItem(bot, ['totem_of_undying', 'totem'])
    const gapple = findFirstItem(bot, ['enchanted_golden_apple', 'golden_apple'])

    // Nếu máu <= 3 tim (6 máu) -> ưu tiên totem ở tay trái
    if (hp <= 6 && totem) {
      await bot.equip(totem, 'off-hand')
      return
    }

    // Bình thường giữ táo vàng ở tay trái
    if (gapple) {
      await bot.equip(gapple, 'off-hand')
    }
  } catch (_) {}
}

async function emergencyHeal (bot) {
  try {
    const hp = bot.health
    if (hp <= 0) return

    // Không để xuống dưới 3 tim: nếu <= 8 máu (4 tim) thì ăn táo
    if (hp <= 8) {
      const gapple = findFirstItem(bot, ['enchanted_golden_apple', 'golden_apple'])
      if (gapple) {
        await bot.equip(gapple, 'hand')
        bot.activateItem()
        setTimeout(() => {
          try { bot.deactivateItem() } catch (_) {}
        }, 900)
      }
    }
  } catch (_) {}
}

async function throwPearlAt (bot, target) {
  try {
    const pearl = findFirstItem(bot, 'ender_pearl')
    if (!pearl) return

    await bot.equip(pearl, 'hand')
    await bot.lookAt(target.position.offset(0, 1.5, 0), true)
    bot.activateItem() // ném pearl
  } catch (_) {}
}

async function escapeWebWithWater (bot) {
  try {
    if (bot._escapingWeb) return
    const waterBucket = findFirstItem(bot, 'water_bucket')
    if (!waterBucket) return

    bot._escapingWeb = true

    // Đặt nước dưới chân để phá tơ
    const feet = bot.entity.position.floored()
    const below = bot.blockAt(feet.offset(0, -1, 0))
    if (below) {
      await bot.equip(waterBucket, 'hand')
      await bot.lookAt(below.position.offset(0.5, 1, 0.5), true)
      await bot.placeBlock(below, new Vec3(0, 1, 0))
    }

    // Chờ nước phá tơ rồi hốt lại nước
    setTimeout(async () => {
      try {
        const bucket = findFirstItem(bot, 'bucket')
        if (!bucket) return
        const water = bot.findBlock({
          matching: b => b && b.name === 'water',
          maxDistance: 5
        })
        if (water) {
          await bot.equip(bucket, 'hand')
          await bot.lookAt(water.position.offset(0.5, 0.5, 0.5), true)
          await bot.activateBlock(water)
        }
      } catch (_) {
        // ignore
      } finally {
        bot._escapingWeb = false
      }
    }, 1200)
  } catch (_) {
    bot._escapingWeb = false
  }
}

async function placeWebTrap (bot, target) {
  try {
    const web = findFirstItem(bot, ['cobweb', 'web'])
    if (!web) return

    const dist = bot.entity.position.distanceTo(target.position)
    if (dist > 4) return // phải đủ gần

    const below = bot.blockAt(target.position.offset(0, -1, 0).floored())
    if (!below) return

    await bot.equip(web, 'hand')
    await bot.lookAt(target.position.offset(0.5, 0.2, 0.5), true)
    await bot.placeBlock(below, new Vec3(0, 1, 0))
  } catch (_) {}
}

async function useBuffPotion (bot) {
  try {
    const now = Date.now()
    if (bot._lastPotion && now - bot._lastPotion < 8000) return

    const pot = findFirstItem(bot, ['potion', 'splash_potion', 'lingering_potion'])
    if (!pot) return

    bot._lastPotion = now
    await bot.equip(pot, 'hand')
    bot.activateItem()
    setTimeout(() => {
      try { bot.deactivateItem() } catch (_) {}
    }, 850)
  } catch (_) {}
}

async function shootBowAt (bot, target) {
  try {
    const bow = findFirstItem(bot, 'bow')
    const arrow = findFirstItem(bot, ['arrow', 'tipped_arrow'])
    if (!bow || !arrow) return

    await bot.equip(bow, 'hand')
    await bot.lookAt(target.position.offset(0, 1.4, 0), true)
    bot.activateItem() // kéo cung
    setTimeout(() => {
      try { bot.deactivateItem() } catch (_) {}
    }, 450)
  } catch (_) {}
}

function setupHT1Brain (bot) {
  bot._combatState = {
    lastPearl: 0,
    lastWeb: 0,
    lastBow: 0
  }

  // Quản lý máu, táo vàng, totem
  bot.on('health', () => {
    ensureOffhand(bot)
    emergencyHeal(bot)
  })

  // Vòng lặp combat chính
  setInterval(() => {
    if (!bot.entity || !bot.entity.position) return

    const target = getNearestEnemyPlayer(bot, 80) // tầm nhìn rộng

    if (target) {
      // Tự động bật PvP + dí đối thủ
      if (!bot.pvp.target || bot.pvp.target.id !== target.id) {
        bot.pvp.attack(target)
      }

      // luôn nhìn về phía đối thủ để combat trông pro hơn
      bot.lookAt(target.position.offset(0, 1.6, 0), true).catch(() => {})

      const now = Date.now()
      const dist = bot.entity.position.distanceTo(target.position)

      // Buff speed + strength trước combat
      useBuffPotion(bot)

      // Dùng ender pearl để áp sát khi khoảng cách xa
      if (dist > 12 && dist < 60 && now - bot._combatState.lastPearl > 5000) {
        bot._combatState.lastPearl = now
        throwPearlAt(bot, target)
      }

      // Khi tới rất gần thì đặt tơ để nhốt đối thủ
      if (dist < 4 && now - bot._combatState.lastWeb > 3500) {
        bot._combatState.lastWeb = now
        placeWebTrap(bot, target)
      }

      // Nếu đối thủ đang dính tơ -> bật auto bow spam
      if (isEntityInWeb(bot, target) && now - bot._combatState.lastBow > 1200) {
        bot._combatState.lastBow = now
        shootBowAt(bot, target)
      }
    } else {
      // Không có mục tiêu -> tắt PvP
      if (bot.pvp.target) bot.pvp.stop()
    }

    // Nếu bot bị dính tơ -> tự thoát bằng xô nước
    if (isBotInWeb(bot)) {
      escapeWebWithWater(bot)
    }
  }, 250) // 4 lần / giây cho combat mượt
}

function createBot (name) {
  const bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: name,
    auth: AUTH_MODE
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(autoEat)
  bot.loadPlugin(pvp)

  bot.once('spawn', () => {
    console.log(`[${name}] joined with HT1 brain!`)

    // Auto ăn đồ thường (không tốn táo vàng)
    bot.autoEat.options = {
      priority: 'foodPoints',
      startAt: 14,
      bannedFood: ['golden_apple', 'enchanted_golden_apple']
    }

    const mcData = require('minecraft-data')(bot.version)
    const movements = new Movements(bot, mcData)
    bot.pathfinder.setMovements(movements)

    setupHT1Brain(bot)
  })

  bot.on('kicked', r => console.log(`[${name}] kicked:`, r))
  bot.on('error', e => console.log(`[${name}] error:`, e))

  return bot
}

;(async () => {
  for (const name of BOT_NAMES) {
    createBot(name)
    await wait(2500)
  }
})()
