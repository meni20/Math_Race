import type { CarId } from "../types/messages";
import { GARAGE_CARS } from "./carCatalog";

export const AVAILABLE_CAR_IDS = GARAGE_CARS.map((car) => car.id) as CarId[];
export const DEFAULT_CAR_ID: CarId = "bmw-m3";

export function normalizeCarId(carId: string | null | undefined): CarId {
  return AVAILABLE_CAR_IDS.find((entry) => entry === carId) ?? DEFAULT_CAR_ID;
}

export function getRandomCarId(): CarId {
  return AVAILABLE_CAR_IDS[Math.floor(Math.random() * AVAILABLE_CAR_IDS.length)] ?? DEFAULT_CAR_ID;
}
