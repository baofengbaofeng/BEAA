/**
 * 学知守护 · ArkUI交互演示页面
 * 演示状态只在内存中保存；未接系统使用时长/应用限制API。
 * TODO: 真实版本须连接可信计时器、题库与持久化规则引擎。
 */
interface DemoQuestion {
  stem: string;
  options: string[];
  correctIndex: number;
  explain: string;
  subject: string;
}

const DEMO_QUESTIONS: DemoQuestion[] = [
  { stem: '36 ÷ 4 + 7 = ?', options: ['14', '15', '16', '17'], correctIndex: 2, explain: '先算除法9，再加7，答案是16。', subject: '数学' },
  { stem: '8 × 6 = ?', options: ['42', '48', '54', '56'], correctIndex: 1, explain: '8乘6等于48。', subject: '数学' },
  { stem: '“春眠不觉晓”的下一句是？', options: ['处处闻啼鸟', '花落知多少', '夜来风雨声', '床前明月光'], correctIndex: 0, explain: '出自孟浩然《春晓》。', subject: '语文' },
  { stem: 'apple 的中文意思是？', options: ['梨', '香蕉', '苹果', '橙子'], correctIndex: 2, explain: 'apple表示苹果。', subject: '英语' },
  { stem: '15 + 17 = ?', options: ['30', '31', '32', '33'], correctIndex: 2, explain: '15+17=32。', subject: '数学' }
];

@Entry
@Component
struct Index {
  // 0 首页 / 1 答题 / 2 通过 / 3 家长设置 / 4 休息
  @State private screen: number = 0;
  @State private questionIndex: number = 0;
  @State private correctCount: number = 0;
  @State private answerNote: string = '';
  @State private minutesPerRound: number = 30;
  @State private dailyMinutes: number = 120;
  @State private subjects: string = '语文、数学、英语';
  @State private restMinutes: number = 10;

  private navigate(next: number): void {
    this.screen = next;
  }

  private beginChallenge(): void {
    this.questionIndex = 0;
    this.correctCount = 0;
    this.answerNote = '';
    this.screen = 1;
  }

  private choose(index: number): void {
    const question: DemoQuestion = DEMO_QUESTIONS[this.questionIndex];
    if (index !== question.correctIndex) {
      this.answerNote = '再想一想：' + question.explain;
      return;
    }
    this.correctCount += 1;
    this.answerNote = '';
    if (this.questionIndex === DEMO_QUESTIONS.length - 1) {
      this.screen = 2;
    } else {
      this.questionIndex += 1;
    }
  }

  @Builder
  private cardTitle(name: string, hint: string) {
    Column({ space: 6 }) {
      Text(name).fontSize(23).fontWeight(FontWeight.Bold).fontColor('#174B53')
      Text(hint).fontSize(15).fontColor('#52757C')
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  @Builder
  private homePage() {
    Column({ space: 18 }) {
      this.cardTitle('今天也要健康用屏', '适度娱乐，认真学习，记得让眼睛休息哦')
      GridRow({
        columns: 12,
        gutter: { x: 16, y: 16 },
        breakpoints: { value: ['700vp'], reference: BreakpointsReference.WindowSize }
      }) {
        GridCol({ span: { xs: 12, sm: 6 } }) {
          Column({ space: 14 }) {
            Text('本轮剩余使用时间').fontColor('#426F76').fontSize(17)
            Text(this.minutesPerRound.toString() + ' 分钟')
              .fontSize(48).fontWeight(FontWeight.Bold).fontColor('#087F82')
            Text('已准备好下一轮学习挑战').fontSize(15).fontColor('#597D82')
            Button('模拟使用时间到期')
              .width('100%').height(52).backgroundColor('#128D8B')
              .onClick(() => this.beginChallenge())
          }
          .padding(22).backgroundColor('#FFFFFF').borderRadius(22).width('100%')
        }
        GridCol({ span: { xs: 12, sm: 6 } }) {
          Column({ space: 14 }) {
            Text('今日使用概览').fontSize(22).fontWeight(FontWeight.Bold).fontColor('#174B53')
            Text('今日已使用：0 分钟').fontSize(17).fontColor('#426F76')
            Text('每日上限：' + this.dailyMinutes.toString() + ' 分钟')
              .fontSize(17).fontColor('#426F76')
            Text('温馨提醒：连续使用后需要完成学习挑战及休息。')
              .fontSize(15).fontColor('#597D82')
          }
          .alignItems(HorizontalAlign.Start)
          .padding(22).backgroundColor('#FFFFFF').borderRadius(22).width('100%')
        }
      }
    }
  }

  @Builder
  private challengePage() {
    Column({ space: 18 }) {
      this.cardTitle('学习挑战', '全部答对后可获得下一轮使用资格')
      GridRow({
        columns: 12,
        gutter: { x: 16, y: 16 },
        breakpoints: { value: ['700vp'], reference: BreakpointsReference.WindowSize }
      }) {
        GridCol({ span: { xs: 12, sm: 6 } }) {
          Column({ space: 16 }) {
            Text(DEMO_QUESTIONS[this.questionIndex].subject + ' · 三年级')
              .fontSize(17).fontColor('#087F82')
            Text('第 ' + (this.questionIndex + 1).toString() + ' / 5 题')
              .fontSize(18).fontColor('#52757C')
            Text(DEMO_QUESTIONS[this.questionIndex].stem)
              .fontSize(30).fontWeight(FontWeight.Bold).fontColor('#174B53')
          }
          .alignItems(HorizontalAlign.Start)
          .padding(24).backgroundColor('#FFFFFF').borderRadius(22).width('100%')
        }
        GridCol({ span: { xs: 12, sm: 6 } }) {
          Column({ space: 12 }) {
            ForEach(DEMO_QUESTIONS[this.questionIndex].options, (option: string, index: number) => {
              Button(String.fromCharCode(65 + index) + '  ' + option)
                .fontSize(20).fontColor('#174B53').backgroundColor('#D9F1EC')
                .borderRadius(14).width('100%').height(54)
                .onClick(() => this.choose(index))
            }, (option: string, index: number) => index.toString())
            if (this.answerNote.length > 0) {
              Text(this.answerNote).fontSize(16).fontColor('#A65823')
            }
            Button('暂不答题，去休息')
              .fontColor('#52757C').backgroundColor('#EDF5F3')
              .onClick(() => this.navigate(4))
          }
          .padding(20).backgroundColor('#FFFFFF').borderRadius(22).width('100%')
        }
      }
    }
  }

  @Builder
  private successPage() {
    Column({ space: 18 }) {
      this.cardTitle('挑战成功！', '你已经完成了今天这一轮学习挑战')
      Column({ space: 18 }) {
        Text('🏆').fontSize(70)
        Text('全部答对，真棒！').fontSize(29).fontWeight(FontWeight.Bold).fontColor('#087F82')
        Text('你已获得下一轮 ' + this.minutesPerRound.toString() + ' 分钟的使用资格')
          .fontSize(18).fontColor('#174B53')
        Text('请先休息 ' + this.restMinutes.toString() + ' 分钟，保护眼睛')
          .fontSize(17).fontColor('#56767D')
        Button('进入休息页面').height(52).backgroundColor('#128D8B')
          .onClick(() => this.navigate(4))
      }
      .width('100%').padding(28).backgroundColor('#FFFFFF').borderRadius(22)
    }
  }

  @Builder
  private restPage() {
    Column({ space: 18 }) {
      this.cardTitle('休息一下', '把平板放下，看看远处，让眼睛放松')
      Column({ space: 20 }) {
        Text('🌿').fontSize(70)
        Text('建议休息 ' + this.restMinutes.toString() + ' 分钟')
          .fontSize(28).fontWeight(FontWeight.Bold).fontColor('#087F82')
        Text('当前是界面演示，未检测真实离屏休息时间。')
          .fontSize(16).fontColor('#647E82')
        Button('返回主页（仅演示，不代表已解锁）')
          .height(52).backgroundColor('#128D8B')
          .onClick(() => this.navigate(0))
      }
      .padding(26).width('100%').backgroundColor('#FFFFFF').borderRadius(22)
    }
  }

  @Builder
  private parentPage() {
    Column({ space: 18 }) {
      this.cardTitle('家长设置 · 演示', '正式版本需要独立身份验证和持久化保存')
      GridRow({
        columns: 12,
        gutter: { x: 16, y: 16 },
        breakpoints: { value: ['700vp'], reference: BreakpointsReference.WindowSize }
      }) {
        GridCol({ span: { xs: 12, sm: 6 } }) {
          Column({ space: 16 }) {
            Text('时间规则').fontSize(22).fontWeight(FontWeight.Bold).fontColor('#174B53')
            Text('单轮使用 ' + this.minutesPerRound.toString() + ' 分钟').fontSize(18)
            Row({ space: 12 }) {
              Button('− 5 分钟').onClick(() => {
                this.minutesPerRound = Math.max(5, this.minutesPerRound - 5);
              })
              Button('＋ 5 分钟').onClick(() => {
                this.minutesPerRound = Math.min(120, this.minutesPerRound + 5);
              })
            }
            Text('每日上限 ' + this.dailyMinutes.toString() + ' 分钟').fontSize(18)
            Row({ space: 12 }) {
              Button('− 30 分钟').onClick(() => {
                this.dailyMinutes = Math.max(30, this.dailyMinutes - 30);
              })
              Button('＋ 30 分钟').onClick(() => {
                this.dailyMinutes = Math.min(600, this.dailyMinutes + 30);
              })
            }
          }
          .alignItems(HorizontalAlign.Start).padding(22)
          .backgroundColor('#FFFFFF').borderRadius(22).width('100%')
        }
        GridCol({ span: { xs: 12, sm: 6 } }) {
          Column({ space: 16 }) {
            Text('学习规则').fontSize(22).fontWeight(FontWeight.Bold).fontColor('#174B53')
            Text('学习科目：' + this.subjects).fontSize(17).fontColor('#426F76')
            Text('每轮题数：5 道').fontSize(17).fontColor('#426F76')
            Text('通过要求：全部答对').fontSize(17).fontColor('#426F76')
            Text('休息时间：' + this.restMinutes.toString() + ' 分钟')
              .fontSize(17).fontColor('#426F76')
            Text('此页仅供交互预览，修改未保存到设备。')
              .fontSize(15).fontColor('#A65823')
          }
          .alignItems(HorizontalAlign.Start).padding(22)
          .backgroundColor('#FFFFFF').borderRadius(22).width('100%')
        }
      }
    }
  }

  build() {
    Scroll() {
      Column({ space: 20 }) {
        Row({ space: 14 }) {
          Text('📖 学知守护').fontSize(29).fontWeight(FontWeight.Bold).fontColor('#087F82')
          Text('UI 演示版 · 不具备系统锁定功能').fontSize(14).fontColor('#A65823')
        }
        .width('100%')
        .justifyContent(FlexAlign.Start)

        Row({ space: 10 }) {
          Button('儿童主页').onClick(() => this.navigate(0))
          Button('学习挑战').onClick(() => this.beginChallenge())
          Button('家长设置').onClick(() => this.navigate(3))
        }
        .width('100%')

        if (this.screen === 0) {
          this.homePage()
        } else if (this.screen === 1) {
          this.challengePage()
        } else if (this.screen === 2) {
          this.successPage()
        } else if (this.screen === 3) {
          this.parentPage()
        } else {
          this.restPage()
        }
      }
      .width('100%').padding(22).alignItems(HorizontalAlign.Start)
    }
    .width('100%').height('100%').backgroundColor('#F1FAF7')
  }
}
