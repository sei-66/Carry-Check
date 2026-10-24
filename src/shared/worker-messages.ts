// 起動確認専用の通信。搬入可否の判定結果はまだ扱わない。
export interface WorkerRequest {
  type: 'ping';
}

export interface WorkerResponse {
  type: 'pong';
}
