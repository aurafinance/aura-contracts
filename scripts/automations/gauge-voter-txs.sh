echo "Bash script to generate a snapshot"

echo $NODE_URL

# Determine the platform
PLATFORM=$(uname)

if [[ "$PLATFORM" == "Linux" ]]; then
  REFERENCE_DAY=$(date -d '20250429' +'%Y-%m-%d')
  CURRENT_DATE=$(date +%Y-%m-%d)
  DAYS_DIFF=$(( ($(date -d "$CURRENT_DATE" +%s) - $(date -d "$REFERENCE_DAY" +%s)) / 86400 ))
elif [[ "$PLATFORM" == "Darwin" ]]; then
  REFERENCE_DAY=$(date -j -f '%Y%m%d' '20250429' +'%Y-%m-%d')
  CURRENT_DATE=$(date +%Y-%m-%d)
  DAYS_DIFF=$(( ($(date -j -f '%Y-%m-%d' "$CURRENT_DATE" +%s) - $(date -j -f '%Y-%m-%d' "$REFERENCE_DAY" +%s)) / 86400 ))
else
  echo "Unsupported platform: $PLATFORM"
  exit 1
fi

echo $REFERENCE_DAY
echo $CURRENT_DATE
echo $DAYS_DIFF

if (( DAYS_DIFF % 14 != 0 )); then
  echo "Not this Day. Exiting."
  exit 0
fi

yarn
yarn clean
yarn compile
yarn task protocol:gaugeVoter-voteGaugeWeights-tx --network mainnet
RESULT=$?
echo $RESULT
if [ $RESULT -ne 0 ]; then
  echo "Failed to generate gauge voter transactions"
  exit 1
fi

yarn prettier

NOTIFICATION=$'Gauge Voter Transactions\r\n\nReview the latest pr at https://github.com/aurafinance/aura-contracts/pulls\r\n@phijfry, @Oxahtle7'
curl -s --data-urlencode "text=$NOTIFICATION" "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage?chat_id=$TELEGRAM_CHAT_ID" > /dev/null