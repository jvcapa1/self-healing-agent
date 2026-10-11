import { simpleGit } from "simple-git";

async function main() {
  const git = simpleGit(process.cwd());
  const branch = process.env.BRANCH_NAME ?? "main";

  await git.addConfig("user.name", "github-actions[bot]");
  await git.addConfig(
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com"
  );

  await git.add(".");

  const status = await git.status();
  if (status.isClean()) {
    console.log("Nothing to commit");
    return;
  }

  await git.commit(`[${new Date().toISOString()}] chore: apply self-healing updates [skip ci]`);
  await git.push("origin", `HEAD:${branch}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});