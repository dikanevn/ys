// Импорт необходимых зависимостей
import { PublicKey } from "@solana/web3.js";
import { CREATE_CPMM_POOL_PROGRAM } from "@raydium-io/raydium-sdk-v2";

/**
 * Функция для вычисления адреса CPMM-пулы по двум токенам.
 * Адрес определяется как PDA (Program Derived Address) с использованием фиксированного префикса и
 * Буферов (toBuffer()) адресов токенов, отсортированных в лексикографическом порядке.
 *
 * @param tokenMintA - адрес первого токена
 * @param tokenMintB - адрес второго токена
 * @returns Обещание с вычисленным адресом пула в виде PublicKey
 */
function computeCpmmPoolAddress(
  tokenMintA: PublicKey,
  tokenMintB: PublicKey
): PublicKey {
  // Сортируем адреса токенов для обеспечения консистентности вычисления
  const [mintA, mintB] =
    tokenMintA.toBase58() < tokenMintB.toBase58()
      ? [tokenMintA, tokenMintB]
      : [tokenMintB, tokenMintA];

  // Фиксированный префикс для сидов (можно изменить, если в SDK используется другой)
  const seed = Buffer.from("cpmm_pool");

  // Набор сидов: префикс и адреса токенов в виде буферов
  const seeds = [seed, mintA.toBuffer(), mintB.toBuffer()];

  // Вычисляем PDA используя синхронный вызов
  const [poolAddress] = PublicKey.findProgramAddressSync(seeds, CREATE_CPMM_POOL_PROGRAM);

  return poolAddress;
}

/**
 * Новая функция для вычисления адреса CPMM-пула с обратным порядком токенов.
 * Для удобства, сначала токены сортируются (как в основном варианте), затем
 * применяется обратный порядок при формировании сидов.
 *
 * @param tokenMintA - адрес первого токена
 * @param tokenMintB - адрес второго токена
 * @returns Обещание с вычисленным адресом пула в виде PublicKey (обратный порядок токенов)
 */
function computeCpmmPoolAddressReversed(
  tokenMintA: PublicKey,
  tokenMintB: PublicKey
): PublicKey {
  // Сортируем адреса токенов для единого порядка
  const [mintA, mintB] =
    tokenMintA.toBase58() < tokenMintB.toBase58()
      ? [tokenMintA, tokenMintB]
      : [tokenMintB, tokenMintA];

  // Фиксированный префикс для сидов
  const seed = Buffer.from("cpmm_pool");

  // Обратный порядок: сначала буфер второго токена, затем первого
  const seeds = [seed, mintB.toBuffer(), mintA.toBuffer()];

  // Вычисляем PDA используя синхронный вызов
  const [poolAddress] = PublicKey.findProgramAddressSync(seeds, CREATE_CPMM_POOL_PROGRAM);

  return poolAddress;
}

// Пример использования функций
(() => {
  // Задаем адреса токенов для CPMM-пула
  const tokenMintA = new PublicKey("9aGQqWqHSeyVtQXNkPuTUZ3aW288fjeRLQcMmjniivEf");
  const tokenMintB = new PublicKey("So11111111111111111111111111111111111111112");

  // Вычисляем адрес пула по каноническому (отсортированному) порядку токенов
  const poolAddressSorted = computeCpmmPoolAddress(tokenMintA, tokenMintB);
  // Вычисляем адрес пула с обратным порядком токенов
  const poolAddressReversed = computeCpmmPoolAddressReversed(tokenMintA, tokenMintB);

  console.log("CPMM Pool Address (sorted):", poolAddressSorted.toBase58());
  console.log("CPMM Pool Address (reversed):", poolAddressReversed.toBase58());
})(); 