#!/bin/zsh
cd "$(dirname "$0")"

clear
echo "停止算法题数据生成器"
echo "===================="
echo

pids=$(ps -axo pid=,command= | awk '/node app\\/server\\.js/ {print $1}')
if [ -z "$pids" ]; then
  echo "没有发现正在运行的本地服务。"
else
  echo "正在关闭：$pids"
  echo "$pids" | xargs kill 2>/dev/null
  sleep 1
  echo "已停止。"
fi

echo
read "?按回车关闭窗口..."
