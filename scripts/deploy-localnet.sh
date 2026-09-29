echo "=== SSS Localnet Deployment Script ==="
if [ ! -f "$HOME/.config/solana/sss-deploy.json" ]; then
    echo "Creating new deployment keypair..."
    solana-keygen new -o "$HOME/.config/solana/sss-deploy.json" --no-bip39-passphrase
fi

DEPLOYER=$(solana-keygen pubkey "$HOME/.config/solana/sss-deploy.json")
echo "Deployer Address: $DEPLOYER"

echo "1. Building Anchor programs..."
anchor build

echo "2. Starting Local Test Validator & Funding..."
# Kill any existing validator
killall solana-test-validator || true
rm -rf /tmp/test-ledger

# Start validator in background
nohup solana-test-validator --reset --ledger /tmp/test-ledger > validator.log 2>&1 &
VALIDATOR_PID=$!
echo "Waiting for test validator to boot..."
# Wait up to 30 seconds for the validator to respond
for i in {1..30}; do
  if solana cluster-version -u http://127.0.0.1:8899 > /dev/null 2>&1; then
    echo "Validator is up!"
    sleep 2
    break
  fi
  sleep 1
done

# Transfer 10 SOL from the rich default local validator keypair to our deployer
solana transfer -u http://127.0.0.1:8899 --from "$HOME/.config/solana/id.json" "$HOME/.config/solana/sss-deploy.json" 10 --allow-unfunded-recipient || true

echo "3. Extracting Program IDs..."

if [ -d "$HOME/.cargo/targets/solana-stablecoin-standard/deploy" ]; then
    echo "Copying WSL target artifacts to local target directory..."
    mkdir -p target/deploy
    cp -rf "$HOME/.cargo/targets/solana-stablecoin-standard/deploy/"* target/deploy/
    DEPLOY_DIR="target/deploy"
elif [ -d "target/deploy" ]; then
    DEPLOY_DIR="target/deploy"
else
    echo "Error: deploy directory not found"
    exit 1
fi

SSS_PROGRAM_ID=$(solana-keygen pubkey $DEPLOY_DIR/sss_token-keypair.json)
HOOK_PROGRAM_ID=$(solana-keygen pubkey $DEPLOY_DIR/transfer_hook-keypair.json)

echo "SSS Program ID: $SSS_PROGRAM_ID"
echo "Transfer Hook ID: $HOOK_PROGRAM_ID"

echo "4. Deploying to Localnet..."
anchor deploy --provider.cluster localnet --program-keypair $DEPLOY_DIR/sss_token-keypair.json --program-name sss_token
anchor deploy --provider.cluster localnet --program-keypair $DEPLOY_DIR/transfer_hook-keypair.json --program-name transfer_hook

echo "5. Running Verification Script..."
cd scripts
# We use tsx because we're outside a transpiled package context
export SSS_PROGRAM_ID=$SSS_PROGRAM_ID
export HOOK_PROGRAM_ID=$HOOK_PROGRAM_ID
export USE_LOCALNET=true
npx tsx verify-devnet.ts

echo "=== DEPLOYMENT COMPLETE ==="
echo "Please copy the outputs above into DEPLOYMENT.md"

echo "Cleaning up..."
kill $VALIDATOR_PID || true
