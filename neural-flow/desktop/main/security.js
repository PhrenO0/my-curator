// PIN 해시 — scrypt(무작위 salt). 원문 PIN 은 어디에도 저장하지 않는다.
const crypto = require('crypto')

function hashPin(pin) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(pin), salt, 32)
  return `scrypt:${salt.toString('base64')}:${hash.toString('base64')}`
}

function verifyPin(pin, stored) {
  const [kind, salt, hash] = String(stored || '').split(':')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const want = Buffer.from(hash, 'base64')
  const got = crypto.scryptSync(String(pin), Buffer.from(salt, 'base64'), want.length)
  return crypto.timingSafeEqual(want, got)
}

module.exports = { hashPin, verifyPin }
