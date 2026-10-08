import { recreateE2eDatabase } from "./database";

export default async function globalSetup() {
  await recreateE2eDatabase();
}
