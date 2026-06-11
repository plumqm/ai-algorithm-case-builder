#!/bin/zsh
cd "$(dirname "$0")"

clear
echo "算法题数据生成器"
echo "================"
echo

if [ -f ".env.local" ]; then
  source ".env.local"
fi

old_pids=$(ps -axo pid=,command= | awk '/node app\\/server\\.js/ {print $1}')
if [ -n "$old_pids" ]; then
  echo "发现旧的本地服务，正在关闭..."
  echo "$old_pids" | xargs kill 2>/dev/null
  sleep 1
fi

echo
echo "正在启动并打开浏览器..."
echo "可以在网页里选择 GPT / Claude / DeepSeek / 自定义接口。"
echo "关闭这个终端窗口会停止本地服务。"
echo

AUTO_OPEN=1 npm start

echo
read "?服务已停止，按回车关闭窗口..."
