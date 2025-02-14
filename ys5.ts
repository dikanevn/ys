import { PublicKey } from '@solana/web3.js'
import { CREATE_CPMM_POOL_PROGRAM } from '@raydium-io/raydium-sdk-v2'

/**
 * Вычисляет адрес пула CPMM по адресам двух токенов.
 * Для обоих вариантов (AB и BA) проверяет, совпадает ли вычисленный адрес с EPSRjzgevLHLm1xp5PNa816LYhmn2VUb9FTpXNsbvFHP.
 * @param tokenMintA Адрес первого токена (mint)
 * @param tokenMintB Адрес второго токена (mint)
 * @returns Объект с вычисленным адресом пула (poolAddress) и значением bump
 */
export async function computeCpmmPoolAddress(
  tokenMintA: string,
  tokenMintB: string
): Promise<{ poolAddress: PublicKey; bump: number }> {
  // Создаем объекты PublicKey для токенов
  const mintA = new PublicKey(tokenMintA)
  const mintB = new PublicKey(tokenMintB)

  // Ожидаемый адрес пула для проверки
  const expectedAddress = new PublicKey("EPSRjzgevLHLm1xp5PNa816LYhmn2VUb9FTpXNsbvFHP")

  // Вычисляем адрес для варианта AB (без сортировки)
  const seedAB = Buffer.from("cpmm")
  const seedsAB = [seedAB, mintA.toBuffer(), mintB.toBuffer()]
  const [poolAddressAB, bumpAB] = PublicKey.findProgramAddressSync(
    seedsAB,
    new PublicKey(CREATE_CPMM_POOL_PROGRAM)
  )

  // Если адрес для варианта AB совпадает с ожидаемым, возвращаем его
  if (poolAddressAB.equals(expectedAddress)) {
    return { poolAddress: poolAddressAB, bump: bumpAB }
  }

  // Вычисляем адрес для варианта BA
  const seedBA = Buffer.from("cpmm")
  const seedsBA = [seedBA, mintB.toBuffer(), mintA.toBuffer()]
  const [poolAddressBA, bumpBA] = PublicKey.findProgramAddressSync(
    seedsBA,
    new PublicKey(CREATE_CPMM_POOL_PROGRAM)
  )

  // Если адрес для варианта BA совпадает с ожидаемым, возвращаем его
  if (poolAddressBA.equals(expectedAddress)) {
    return { poolAddress: poolAddressBA, bump: bumpBA }
  }

  // Если ни один из вариантов не совпадает, выбрасываем ошибку
  throw new Error("Ни один из вариантов seed не соответствует ожидаемому адресу пула")
}

// Пример использования: вычисление адреса пула для пары токено
(async () => {
  try {
    const tokenA = "9aGQqWqHSeyVtQXNkPuTUZ3aW288fjeRLQcMmjniivEf" 
    const tokenB = "So11111111111111111111111111111111111111112" 

    const { poolAddress, bump } = await computeCpmmPoolAddress(tokenA, tokenB)

    console.log("CPMM Pool Address:", poolAddress.toBase58())
    console.log("Bump Seed:", bump)
  } catch (error) {
    console.error("Ошибка при вычислении адреса пула:", error)
  }
})() 