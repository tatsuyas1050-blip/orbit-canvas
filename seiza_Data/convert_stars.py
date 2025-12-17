import pandas as pd
import json

def convert_data():
    # 1. 星座線データの変換 (cons_lineData.csv)
    try:
        # Shift-JISで読み込み
        df_lines = pd.read_csv('cons_lineData.csv', header=None, encoding='shift_jis')
        line_data = []
        for _, row in df_lines.iterrows():
            line_data.append({
                "ra1": float(row[2]),
                "dec1": float(row[3]),
                "ra2": float(row[6]),
                "dec2": float(row[7])
            })
        
        # indent=4 を追加して見やすく整形
        with open('constellation_lines.json', 'w', encoding='utf-8') as f:
            json.dump(line_data, f, ensure_ascii=False, indent=4)
        print("作成完了: constellation_lines.json")
            
    except Exception as e:
        print(f"エラー (lines): {e}")

    # 2. 星座名データの変換 (cons_nameData.csv)
    try:
        # Shift-JISで読み込み
        df_names = pd.read_csv('cons_nameData.csv', header=None, encoding='shift_jis')
        label_data = []
        for _, row in df_names.iterrows():
            # 赤経(時・分)を角度(度)に変換: (h + m/60) * 15
            ra_deg = (float(row[1]) + float(row[2]) / 60.0) * 15.0
            label_data.append({
                "name": row[0],
                "ra": ra_deg,
                "dec": float(row[3])
            })
            
        # indent=4 を追加して見やすく整形
        with open('constellation_labels.json', 'w', encoding='utf-8') as f:
            json.dump(label_data, f, ensure_ascii=False, indent=4)
        print("作成完了: constellation_labels.json")

    except Exception as e:
        print(f"エラー (names): {e}")

if __name__ == "__main__":
    convert_data()