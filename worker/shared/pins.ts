export function isValidPin(pin: string) {
  return /^[0-9]{6}$/.test(pin);
}
