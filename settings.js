// 팝업과 백그라운드가 함께 쓰는 기본 설정
const ECP_DEFAULTS = {
  mode: 'single',         // 'single' = 한 장짜리 긴 페이지, 'a4' = A4 분할
  orientation: 'portrait',// A4: 'portrait' | 'landscape'
  marginMm: 0,            // 여백(mm), 두 모드 공통
  fitWidth: true,         // A4: 요소 폭을 용지 폭에 맞춰 축소
  printBackground: true,  // 배경색/배경 이미지 포함
  screenMedia: true,      // 사이트의 인쇄용 CSS 대신 화면 그대로 출력
  expandScroll: true,     // 선택한 요소의 내부 스크롤을 펼쳐서 전체 내용 출력
  saveAs: false           // 저장할 때마다 위치 묻기
};
