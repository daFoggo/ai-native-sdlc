# Pilot: sdlc 0.5.3 trên wattprint (từ 2026-11-24)

Mục tiêu: biết plugin có **dùng được, cho kết quả tốt, không lỗi, không phí token** trên việc thật. Không tắt
hay đổi gì để so sánh: chạy đúng quy trình như mọi ngày. Số liệu máy đo được lấy sau từ transcript, nên phần bạn
ghi tay chỉ là những gì máy không biết.

## Trước khi bắt đầu (một lần)
1. `claude plugin update sdlc@ai-native-sdlc` rồi mở session mới; dòng đầu session phải nhắc sdlc.
2. Commit `.claude/sdlc.json` (mục `skills`) trong wattprint-nextjs.
3. Mỗi task một session mới (`/clear` giữa các task không liên quan). Một session nhiều task thì số liệu lẫn nhau.

## Mỗi task: bạn ghi một dòng
| Ngày | Repo | Task (một câu) | Lane agent chọn | Lane đúng? | Kết quả 1–5 | Bug phát hiện sau | Lúc khó chịu / kẹt |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

- **Kết quả 1–5:** 5 = merge được không sửa; 3 = phải sửa tay một ít; 1 = làm lại.
- **Bug phát hiện sau:** bug do task này gây ra mà review không bắt (ghi khi thấy, kể cả vài ngày sau).
- **Lúc khó chịu / kẹt:** agent hỏi thừa, chờ lâu, lặp lại, bị hook chặn vô lý, skill gọi sai, review lôi thôi.
  Một vài chữ là đủ; mình đối chiếu với transcript.

## Máy đo (mình lấy từ transcript `~/.claude/projects/<repo>/*.jsonl`, bạn không cần làm)
- **Skill:** lần sửa đầu có bị chặn không, agent có gọi đúng skill được map không, hay bỏ qua bằng một dòng lý do;
  skill có được gọi trước khi bị chặn không (tức là agent tự nhớ).
- **Token:** tổng mỗi task, chia theo phần: khởi động, skill nạp vào, đọc code, build, review (R1/R2/R3), verify.
- **Review:** số vòng, số finding mỗi mức, finding nào là thật (đối chiếu với cột "Bug phát hiện sau").
- **Hook:** số lần check fail sau khi sửa, số lần verify chặn ở Stop và thời gian mỗi lần, deny của guard.
- **Quy trình:** có nói lại yêu cầu không, lane có đổi giữa chừng không, artifact có đúng chỗ không
  (friction #7: plan có rơi vào `docs/superpowers/` không).

## Khi nào gửi lại
Sau khoảng 5–10 task, hoặc ngay khi có lỗi rõ (hook chặn sai, agent kẹt vòng lặp, token tăng vọt): gửi bảng trên
và tên repo. Mình đọc transcript, đối chiếu, rồi quyết định:
- friction #7 (writing-plans), #9 (verify chậm), #12 (R1 đắt) có cần sửa không;
- lane M có cần R1 không, hay chỉ lane L (mục "Measure the pilot" trong ROADMAP);
- skill nào map thừa (nạp mà không dùng) để bỏ khỏi `skills`.
